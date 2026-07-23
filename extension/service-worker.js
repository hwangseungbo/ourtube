const LOCAL_API = "http://127.0.0.1:4545";
const TRUSTED_WEBSITE_ORIGINS = new Set([
  "http://127.0.0.1:4545",
  "http://localhost:4545",
  "https://ourtube.kr",
  "https://www.ourtube.kr",
]);
const PROBE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const CAPTURE_KEY_PREFIX = "googlevideo-capture:";
const PLAYER_RESPONSE_KEY_PREFIX = "youtube-player-response:";
const PLAYER_RESPONSE_VIDEO_KEY_PREFIX = "youtube-player-response-video:";
const JOB_ROUTE_KEY_PREFIX = "integrated-download-job:";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const captureWriteQueues = new Map();
let creatingOffscreenDocument = null;

const VIDEO_ITAGS = new Map([
  ["160", { codec: "avc1", height: 144 }],
  ["133", { codec: "avc1", height: 240 }],
  ["134", { codec: "avc1", height: 360 }],
  ["135", { codec: "avc1", height: 480 }],
  ["136", { codec: "avc1", height: 720 }],
  ["137", { codec: "avc1", height: 1080 }],
  ["264", { codec: "avc1", height: 1440 }],
  ["266", { codec: "avc1", height: 2160 }],
  ["247", { codec: "vp9", height: 720 }],
  ["248", { codec: "vp9", height: 1080 }],
  ["271", { codec: "vp9", height: 1440 }],
  ["313", { codec: "vp9", height: 2160 }],
  ["398", { codec: "av01", height: 720 }],
  ["399", { codec: "av01", height: 1080 }],
  ["400", { codec: "av01", height: 1440 }],
  ["401", { codec: "av01", height: 2160 }],
]);

const AUDIO_ITAGS = new Map([
  ["139", { codec: "mp4a.40.5" }],
  ["140", { codec: "mp4a.40.2" }],
  ["141", { codec: "mp4a.40.2" }],
  ["249", { codec: "opus" }],
  ["250", { codec: "opus" }],
  ["251", { codec: "opus" }],
]);

function isAllowedMediaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (host === "googlevideo.com" || host.endsWith(".googlevideo.com"));
  } catch {
    return false;
  }
}

function decodeBase64(value) {
  if (typeof value !== "string" || value.length > 4 * 1024 * 1024) {
    throw new Error("Onesie 요청 데이터가 올바르지 않습니다.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function readResponseTolerantly(response) {
  if (!response.body) return { bytes: new Uint8Array(await response.arrayBuffer()), incomplete: false };

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let incomplete = false;
  let readError = null;
  try {
    while (true) {
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        incomplete = true;
        readError = error;
        break;
      }
      if (result.done) break;
      if (!result.value?.byteLength) continue;
      chunks.push(result.value);
      totalBytes += result.value.byteLength;
      if (totalBytes > 16 * 1024 * 1024) {
        throw new Error("Onesie 응답이 허용 크기를 초과했습니다.");
      }
    }
  } finally {
    if (incomplete) await reader.cancel().catch(() => {});
  }

  if (totalBytes === 0 && readError) throw readError;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, incomplete };
}

async function fetchOnesie({ url: rawUrl, bodyBase64 }) {
  if (!isAllowedMediaUrl(rawUrl)) throw new Error("허용되지 않은 Onesie 주소입니다.");
  const url = new URL(rawUrl);
  if (url.pathname !== "/initplayback") throw new Error("허용되지 않은 Onesie 요청 경로입니다.");
  const body = decodeBase64(bodyBase64);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      body,
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
  } catch (error) {
    throw new Error(`Onesie 연결 실패 (${url.hostname}): ${error instanceof Error ? error.message : "네트워크 오류"}`);
  }
  if (!response.ok) throw new Error(`Onesie 응답 오류 (${response.status})`);

  let responseBody;
  try {
    responseBody = await readResponseTolerantly(response);
  } catch (error) {
    throw new Error(`Onesie 응답 읽기 실패 (${url.hostname}): ${error instanceof Error ? error.message : "네트워크 오류"}`);
  }
  return {
    status: response.status,
    responseUrl: response.url,
    bodyBase64: encodeBase64(responseBody.bytes),
    incomplete: responseBody.incomplete,
  };
}

function captureStorageKey(tabId) {
  return `${CAPTURE_KEY_PREFIX}${tabId}`;
}

function playerResponseStorageKey(tabId) {
  return `${PLAYER_RESPONSE_KEY_PREFIX}${tabId}`;
}

function playerResponseVideoStorageKey(videoId) {
  return `${PLAYER_RESPONSE_VIDEO_KEY_PREFIX}${videoId}`;
}

function jobRouteStorageKey(jobId) {
  return `${JOB_ROUTE_KEY_PREFIX}${jobId}`;
}

function parsePositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeCapturedRequest(details) {
  if (details.tabId < 0 || !isAllowedMediaUrl(details.url)) return null;
  if (String(details.initiator ?? "").startsWith("chrome-extension://")) return null;

  const url = new URL(details.url);
  if (url.searchParams.has("sabr")) return null;
  const mime = (url.searchParams.get("mime") ?? "").toLowerCase();
  const kind = mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : null;
  if (!kind) return null;

  for (const parameter of ["range", "rn", "rbuf"]) url.searchParams.delete(parameter);

  const itag = url.searchParams.get("itag") ?? "";
  const known = kind === "video" ? VIDEO_ITAGS.get(itag) : AUDIO_ITAGS.get(itag);
  const isMp4 = mime.includes("mp4");
  const expirySeconds = parsePositiveNumber(url.searchParams.get("expire"));
  return {
    kind,
    url: url.href,
    itag,
    container: kind === "audio" && isMp4 ? "m4a" : isMp4 ? "mp4" : "webm",
    codec: known?.codec ?? (kind === "audio" && !isMp4 ? "opus" : isMp4 ? "mp4" : "webm"),
    height: kind === "video" ? known?.height ?? parsePositiveNumber(url.searchParams.get("height")) : null,
    approximateBytes: parsePositiveNumber(url.searchParams.get("clen")),
    duration: parsePositiveNumber(url.searchParams.get("dur")),
    expiresAt: expirySeconds ? expirySeconds * 1000 : Date.now() + 5 * 60 * 1000,
    capturedAt: Date.now(),
  };
}

async function storeCapturedRequest(tabId, stream) {
  const key = captureStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const capture = stored[key] ?? { tabId, video: null, audio: null };
  const current = capture[stream.kind];
  const shouldReplace = !current
    || (stream.kind === "video" && (stream.height ?? 0) > (current.height ?? 0))
    || (stream.kind === "audio" && stream.container === "m4a" && current.container !== "m4a")
    || (stream.itag === current.itag && stream.capturedAt > current.capturedAt);
  if (shouldReplace) capture[stream.kind] = stream;
  capture.updatedAt = Date.now();
  await chrome.storage.session.set({ [key]: capture });
}

function queueCapturedRequest(details) {
  const stream = normalizeCapturedRequest(details);
  if (!stream) return;

  const previous = captureWriteQueues.get(details.tabId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => storeCapturedRequest(details.tabId, stream))
    .finally(() => {
      if (captureWriteQueues.get(details.tabId) === next) captureWriteQueues.delete(details.tabId);
    });
  captureWriteQueues.set(details.tabId, next);
}

async function getCapturedState(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("유효한 YouTube 탭이 아닙니다.");
  await (captureWriteQueues.get(tabId) ?? Promise.resolve());
  const key = captureStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? { tabId, video: null, audio: null, updatedAt: null };
}

async function getCaptureStatus(tabId) {
  const capture = await getCapturedState(tabId);
  return {
    tabId,
    hasVideo: Boolean(capture.video),
    hasAudio: Boolean(capture.audio),
    ready: Boolean(capture.video && capture.audio),
    video: capture.video ? {
      itag: capture.video.itag,
      codec: capture.video.codec,
      container: capture.video.container,
      height: capture.video.height,
    } : null,
    audio: capture.audio ? {
      itag: capture.audio.itag,
      codec: capture.audio.codec,
      container: capture.audio.container,
    } : null,
    updatedAt: capture.updatedAt,
  };
}

function validateStoredPlayerResponse(payload) {
  if (typeof payload?.responseJson !== "string" || payload.responseJson.length > 4 * 1024 * 1024) {
    throw new Error("YouTube 플레이어 응답 크기가 올바르지 않습니다.");
  }
  const response = JSON.parse(payload.responseJson);
  const videoId = response?.videoDetails?.videoId;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "") || videoId !== payload.videoId) {
    throw new Error("YouTube 플레이어 영상 정보가 올바르지 않습니다.");
  }
  const serverAbrUrl = response.streamingData?.serverAbrStreamingUrl;
  if (serverAbrUrl) {
    const parsedAbrUrl = new URL(serverAbrUrl);
    if (!isAllowedMediaUrl(parsedAbrUrl.href) || !parsedAbrUrl.pathname.includes("videoplayback")) {
      throw new Error("허용되지 않은 YouTube SABR 주소입니다.");
    }
  }
  const adaptiveFormats = response.streamingData?.adaptiveFormats;
  if (adaptiveFormats && (!Array.isArray(adaptiveFormats) || adaptiveFormats.length > 500)) {
    throw new Error("YouTube SABR 형식 정보가 올바르지 않습니다.");
  }
  return {
    responseJson: payload.responseJson,
    videoId,
    title: String(payload.title || response.videoDetails?.title || "YouTube 영상").slice(0, 300),
    clientInfo: {
      clientName: Number(payload.clientInfo?.clientName) || 1,
      clientVersion: String(payload.clientInfo?.clientVersion || "").slice(0, 100),
    },
    hasServerAbrUrl: Boolean(response.streamingData?.serverAbrStreamingUrl),
    adaptiveFormatCount: Array.isArray(response.streamingData?.adaptiveFormats)
      ? response.streamingData.adaptiveFormats.length
      : 0,
    hasUstreamerConfig: Boolean(
      response.playerConfig
        ?.mediaCommonConfig
        ?.mediaUstreamerRequestConfig
        ?.videoPlaybackUstreamerConfig,
    ),
    capturedAt: Date.now(),
  };
}

async function storeYouTubePlayerResponse(payload, sender) {
  const tabId = sender?.tab?.id;
  const senderUrl = sender?.url || sender?.tab?.url || "";
  if (!isYouTubeUrl(senderUrl)) {
    throw new Error("허용되지 않은 YouTube 플레이어 응답입니다.");
  }
  const stored = validateStoredPlayerResponse(payload);
  if (getCapturedVideoId(senderUrl) !== stored.videoId) {
    throw new Error("YouTube 탭과 플레이어 영상 정보가 일치하지 않습니다.");
  }
  const values = {
    [playerResponseVideoStorageKey(stored.videoId)]: { tabId: Number.isInteger(tabId) ? tabId : null, ...stored },
  };
  if (Number.isInteger(tabId)) {
    values[playerResponseStorageKey(tabId)] = { tabId, ...stored };
  }
  await chrome.storage.session.set(values);
  return {
    stored: true,
    videoId: stored.videoId,
    ready: stored.hasServerAbrUrl && stored.adaptiveFormatCount > 0 && stored.hasUstreamerConfig,
  };
}

async function getYouTubePlayerResponse(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("유효한 YouTube 탭이 아닙니다.");
  const key = playerResponseStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function getPlayerResponseByVideoId(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) throw new Error("YouTube 영상 ID가 올바르지 않습니다.");
  const key = playerResponseVideoStorageKey(videoId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function clearPlayerResponseByVideoId(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) throw new Error("YouTube 영상 ID가 올바르지 않습니다.");
  await chrome.storage.session.remove(playerResponseVideoStorageKey(videoId));
  return { cleared: true };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}

async function clearCapturedState(tabId) {
  captureWriteQueues.delete(tabId);
  await chrome.storage.session.remove([captureStorageKey(tabId), playerResponseStorageKey(tabId)]);
}

async function waitForTabReady(tabId, timeoutMs = 25_000) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise((resolve, reject) => {
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) reject(error);
      else resolve();
    }
    const timeoutId = setTimeout(() => {
      finish(new Error("YouTube 탭을 불러오는 데 시간이 너무 오래 걸립니다."));
    }, timeoutMs);
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      finish();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch(finish);
  });
}

async function primeYouTubePlayback(tabId) {
  const injectionPromise = chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const deadline = Date.now() + 15_000;
      let video = document.querySelector("video");
      while (!video && Date.now() < deadline) {
        await wait(250);
        video = document.querySelector("video");
      }
      if (!video) return { ready: false, error: "YouTube 플레이어를 찾지 못했습니다." };

      const player = document.querySelector("#movie_player");
      try {
        window.postMessage({
          channel: "wetube-youtube-main",
          type: "REQUEST_PLAYER_RESPONSE",
        }, location.origin);
        player?.setPlaybackQualityRange?.("hd1080");
        player?.setPlaybackQuality?.("hd1080");
      } catch {
        // 품질 API가 없는 플레이어에서도 기본 화질로 포착을 계속합니다.
      }

      video.muted = true;
      video.volume = 0;
      video.playsInline = true;
      try {
        await Promise.race([
          video.play(),
          wait(8_000).then(() => {
            throw new Error("백그라운드 자동 재생 응답 시간이 초과되었습니다.");
          }),
        ]);
      } catch (error) {
        return {
          ready: false,
          error: error instanceof Error ? error.message : "자동 재생이 차단됐습니다.",
        };
      }
      return { ready: true, title: document.title };
    },
  });
  const [injection] = await withTimeout(
    injectionPromise,
    12_000,
    "YouTube 백그라운드 재생 준비 시간이 초과되었습니다.",
  );
  const result = injection?.result;
  if (!result?.ready) throw new Error(result?.error || "YouTube 영상을 자동 재생하지 못했습니다.");
  return result;
}

async function pauseYouTubePlayback(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const video = document.querySelector("video");
      if (video) video.pause();
      return document.title;
    },
  }).catch(() => {});
}

async function waitForAutomaticCapture(tabId, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let readySince = 0;
  let lastPrimeAt = 0;

  while (Date.now() < deadline) {
    const status = await getCaptureStatus(tabId);
    if (status.ready) {
      if (!readySince) readySince = Date.now();
      if ((status.video?.height ?? 0) >= 1080 || Date.now() - readySince >= 3_000) return status;
    }

    const playerResponse = await getYouTubePlayerResponse(tabId);
    if (playerResponse?.hasServerAbrUrl
      && playerResponse.adaptiveFormatCount > 0
      && playerResponse.hasUstreamerConfig) {
      return { ready: true, mode: "page-sabr", playerResponse };
    }

    if (Date.now() - lastPrimeAt >= 3_000) {
      lastPrimeAt = Date.now();
      await primeYouTubePlayback(tabId).catch(() => {});
    }
    await delay(500);
  }

  const status = await getCaptureStatus(tabId);
  const found = [status.hasVideo ? "영상" : "", status.hasAudio ? "음성" : ""].filter(Boolean).join("·");
  const detail = found ? `${found}만 포착됐습니다.` : "영상·음성 요청이 포착되지 않았습니다.";
  throw new Error(`${detail} Chrome이 비활성 탭의 재생을 차단했거나 YouTube 응답이 지연되었습니다.`);
}

async function captureInBackground(rawUrl, jobId) {
  const url = String(rawUrl || "").trim();
  if (!isYouTubeUrl(url)) throw new Error("올바른 YouTube 주소를 입력해 주세요.");

  const youtubeTab = await chrome.tabs.create({ url, active: false });
  if (!Number.isInteger(youtubeTab.id)) throw new Error("YouTube 탭을 만들지 못했습니다.");
  await clearCapturedState(youtubeTab.id);

  try {
    await notifyWebsiteJob(jobId, {
      state: "analyzing",
      message: "숨겨진 플레이어가 응답하지 않아 백그라운드에서 영상 정보를 확인하는 중입니다…",
    });
    await waitForTabReady(youtubeTab.id);
    await primeYouTubePlayback(youtubeTab.id).catch(() => {});
    const captureResult = await waitForAutomaticCapture(youtubeTab.id);
    await pauseYouTubePlayback(youtubeTab.id);

    const currentTab = await chrome.tabs.get(youtubeTab.id);
    if (captureResult.mode === "page-sabr") {
      const storedPlayerResponse = await getYouTubePlayerResponse(youtubeTab.id);
      if (!storedPlayerResponse) throw new Error("YouTube SABR 플레이어 정보를 읽지 못했습니다.");
      return { mode: "page-sabr", storedPlayerResponse };
    }
    const captureDownload = await getCapturedDownload({
      tabId: youtubeTab.id,
      sourceUrl: url,
      title: currentTab.title || "YouTube 영상",
    });
    return { mode: "capture", captureDownload };
  } catch (error) {
    throw new Error(`YouTube 백그라운드 포착 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
  } finally {
    await pauseYouTubePlayback(youtubeTab.id);
    await chrome.tabs.remove(youtubeTab.id).catch(() => {});
    await clearCapturedState(youtubeTab.id).catch(() => {});
  }
}

function getCapturedVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
    return url.pathname.split("/").filter(Boolean)[1] ?? "";
  } catch {
    return "";
  }
}

async function getCapturedDownload({ tabId, sourceUrl, title }) {
  const capture = await getCapturedState(tabId);
  if (!capture.video || !capture.audio) {
    throw new Error("영상·음성 요청이 아직 모두 포착되지 않았습니다. 영상을 재생한 뒤 다시 시도해 주세요.");
  }
  const streams = [capture.video, capture.audio];
  const expiresAt = Math.min(...streams.map((stream) => stream.expiresAt));
  if (Date.now() >= expiresAt) throw new Error("포착한 Googlevideo 주소가 만료됐습니다. 영상을 다시 재생해 주세요.");

  return {
    videoId: getCapturedVideoId(sourceUrl),
    title: String(title || "YouTube 영상").replace(/\s+-\s+YouTube\s*$/i, "").slice(0, 300),
    expiresAt,
    captureMode: true,
    streams,
  };
}

chrome.webRequest.onBeforeRequest.addListener(
  queueCapturedRequest,
  { urls: ["https://*.googlevideo.com/*"] },
);

async function readAtMost(response, limit) {
  if (!response.body) return 0;

  const reader = response.body.getReader();
  let received = 0;
  try {
    while (received < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength ?? 0;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Math.min(received, limit);
}

async function probeStream(stream) {
  if (!stream || !isAllowedMediaUrl(stream.url)) {
    throw new Error("허용되지 않은 미디어 주소입니다.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(stream.url, {
      method: "GET",
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    });
    const bytesRead = await readAtMost(response, PROBE_BYTES);
    return {
      kind: stream.kind,
      itag: stream.itag,
      container: stream.container,
      codec: stream.codec,
      height: stream.height,
      ok: (response.status === 200 || response.status === 206) && bytesRead > 0,
      status: response.status,
      bytesRead,
      contentType: response.headers.get("content-type") ?? "",
      contentRange: response.headers.get("content-range") ?? "",
      responseHost: new URL(response.url).hostname,
    };
  } catch (error) {
    return {
      kind: stream.kind,
      itag: stream.itag,
      container: stream.container,
      codec: stream.codec,
      height: stream.height,
      ok: false,
      status: 0,
      bytesRead: 0,
      error: error instanceof Error ? error.message : "요청에 실패했습니다.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runProbe({ url, rightsConfirmed }) {
  const targetResponse = await fetch(`${LOCAL_API}/api/extension/probe-targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, rightsConfirmed }),
    cache: "no-store",
  });
  const targetPayload = await targetResponse.json().catch(() => ({}));
  if (!targetResponse.ok) {
    throw new Error(targetPayload.error ?? `로컬 서버 응답 오류 (${targetResponse.status})`);
  }

  const streams = targetPayload.probe?.streams;
  if (!Array.isArray(streams) || streams.length !== 2) {
    throw new Error("로컬 서버에서 영상·음성 주소를 받지 못했습니다.");
  }
  if (streams.some((stream) => !isAllowedMediaUrl(stream.url))) {
    throw new Error("로컬 서버가 허용되지 않은 미디어 주소를 반환했습니다.");
  }

  const results = await Promise.all(streams.map(probeStream));
  return {
    title: targetPayload.probe.title,
    videoId: targetPayload.probe.videoId,
    testedAt: Date.now(),
    allSucceeded: results.every((result) => result.ok),
    results,
  };
}

function isTrustedWebsiteSender(sender) {
  try {
    const url = new URL(sender?.url || sender?.tab?.url || "");
    return TRUSTED_WEBSITE_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

function isOffscreenSender(sender) {
  return sender?.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
}

async function setJobRoute(jobId, sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("홈페이지 탭 정보를 확인하지 못했습니다.");
  const route = {
    jobId,
    tabId,
    websiteOrigin: new URL(sender.url || sender.tab.url).origin,
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [jobRouteStorageKey(jobId)]: route });
  return route;
}

async function getJobRoute(jobId) {
  const key = jobRouteStorageKey(jobId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] ?? null;
}

async function verifyJobOwner(jobId, sender) {
  if (!isTrustedWebsiteSender(sender)) throw new Error("허용되지 않은 웹사이트 요청입니다.");
  const route = await getJobRoute(jobId);
  if (!route || route.tabId !== sender?.tab?.id) throw new Error("이 홈페이지에서 만든 다운로드 작업이 아닙니다.");
  return route;
}

async function notifyWebsiteJob(jobId, event) {
  const route = await getJobRoute(jobId);
  if (!route) return { delivered: false };
  await chrome.tabs.sendMessage(route.tabId, {
    type: "WETUBE_JOB_EVENT",
    payload: { jobId, ...event },
  }).catch(() => {});
  if (["completed", "failed", "canceled"].includes(event.state)) {
    await chrome.storage.session.remove(jobRouteStorageKey(jobId));
  }
  return { delivered: true };
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["IFRAME_SCRIPTING", "BLOBS"],
      justification: "YouTube 영상 정보를 확인하고 사용자 PC에서 MP4를 결합해 다운로드하기 위해 필요합니다.",
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }
  await creatingOffscreenDocument;
}

async function sendToOffscreen(type, payload) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: "offscreen", type, payload });
  if (!response?.ok) throw new Error(response?.error || "숨겨진 다운로드 엔진이 응답하지 않습니다.");
  return response.result;
}

async function runIntegratedPreparation({ jobId, sourceUrl, route }) {
  try {
    const basePayload = {
      jobId,
      sourceUrl,
      runtimeUrl: `${route.websiteOrigin}/botguard-runtime.html`,
    };
    let preparedResult = await sendToOffscreen("PREPARE_OFFSCREEN_JOB", basePayload);

    if (preparedResult?.needsBackgroundCapture) {
      const captured = await captureInBackground(sourceUrl, jobId);
      preparedResult = await sendToOffscreen("PREPARE_OFFSCREEN_JOB", {
        ...basePayload,
        ...captured,
      });
    }
    if (!preparedResult?.ok || !preparedResult.prepared) {
      throw new Error(preparedResult?.error || "영상 다운로드 정보를 준비하지 못했습니다.");
    }
    await notifyWebsiteJob(jobId, {
      state: "ready",
      message: "준비됐습니다. 화질을 선택하고 다운로드를 시작해 주세요.",
      prepared: preparedResult.prepared,
    });
  } catch (error) {
    await notifyWebsiteJob(jobId, {
      state: "failed",
      message: error instanceof Error ? error.message : "영상 분석에 실패했습니다.",
    });
  }
}

async function queueIntegratedDownload({ url, rightsConfirmed }, sender) {
  if (!isTrustedWebsiteSender(sender)) throw new Error("허용되지 않은 웹사이트 요청입니다.");
  if (!rightsConfirmed) throw new Error("다운로드 권한 확인이 필요합니다.");
  const sourceUrl = String(url || "").trim();
  if (!isYouTubeUrl(sourceUrl)) throw new Error("올바른 YouTube 주소를 입력해 주세요.");

  const jobId = crypto.randomUUID();
  const route = await setJobRoute(jobId, sender);
  await notifyWebsiteJob(jobId, { state: "analyzing", message: "새 탭을 열지 않고 영상 정보를 분석하고 있습니다…" });
  void runIntegratedPreparation({ jobId, sourceUrl, route });
  return { jobId, queued: true, processingLocation: "client" };
}

async function startIntegratedDownload({ jobId, qualityId }, sender) {
  await verifyJobOwner(String(jobId || ""), sender);
  const result = await sendToOffscreen("START_OFFSCREEN_JOB", {
    jobId: String(jobId),
    qualityId: String(qualityId || ""),
  });
  return result;
}

async function cancelIntegratedDownload({ jobId }, sender) {
  await verifyJobOwner(String(jobId || ""), sender);
  return sendToOffscreen("CANCEL_OFFSCREEN_JOB", { jobId: String(jobId) });
}

async function selectIntegratedQuality({ jobId, qualityId }, sender) {
  await verifyJobOwner(String(jobId || ""), sender);
  return sendToOffscreen("SELECT_OFFSCREEN_QUALITY", {
    jobId: String(jobId),
    qualityId: String(qualityId || ""),
  });
}

function waitForDownloadCompletion(downloadId, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const timeoutId = setTimeout(() => finish(new Error("완성 파일 저장 시간이 초과되었습니다.")), timeoutMs);
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") finish();
      if (delta.state?.current === "interrupted") {
        finish(new Error(delta.error?.current || "Chrome 파일 저장이 중단되었습니다."));
      }
    };
    chrome.downloads.onChanged.addListener(onChanged);
    void chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item?.state === "complete") finish();
      if (item?.state === "interrupted") finish(new Error(item.error || "Chrome 파일 저장이 중단되었습니다."));
    }).catch(() => {});
  });
}

async function saveOffscreenFile({ jobId, url, filename }, sender) {
  if (!isOffscreenSender(sender)) throw new Error("허용되지 않은 파일 저장 요청입니다.");
  if (!String(url || "").startsWith(`blob:chrome-extension://${chrome.runtime.id}/`)) {
    throw new Error("허용되지 않은 완성 파일 주소입니다.");
  }
  if (!await getJobRoute(String(jobId || ""))) throw new Error("저장할 다운로드 작업을 찾지 못했습니다.");
  const downloadId = await chrome.downloads.download({
    url,
    filename: String(filename || "아워튜브 영상.mp4"),
    conflictAction: "uniquify",
    saveAs: false,
  });
  await waitForDownloadCompletion(downloadId);
  return { downloadId };
}

async function openDownloadsFolder(_payload, sender) {
  if (!isTrustedWebsiteSender(sender)) throw new Error("허용되지 않은 웹사이트 요청입니다.");
  chrome.downloads.showDefaultFolder();
  return { opened: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === "RUN_GOOGLEVIDEO_PROBE") {
    operation = runProbe(message.payload);
  } else if (message?.type === "GET_CAPTURE_STATUS") {
    operation = getCaptureStatus(message.payload?.tabId);
  } else if (message?.type === "GET_CAPTURED_DOWNLOAD") {
    operation = getCapturedDownload(message.payload ?? {});
  } else if (["OPEN_DIRECT_DOWNLOAD", "PREPARE_INTEGRATED_DOWNLOAD"].includes(message?.type)) {
    operation = queueIntegratedDownload(message.payload ?? {}, sender);
  } else if (message?.type === "START_INTEGRATED_DOWNLOAD") {
    operation = startIntegratedDownload(message.payload ?? {}, sender);
  } else if (message?.type === "SELECT_INTEGRATED_QUALITY") {
    operation = selectIntegratedQuality(message.payload ?? {}, sender);
  } else if (message?.type === "CANCEL_INTEGRATED_DOWNLOAD") {
    operation = cancelIntegratedDownload(message.payload ?? {}, sender);
  } else if (message?.type === "OPEN_DOWNLOADS_FOLDER") {
    operation = openDownloadsFolder(message.payload ?? {}, sender);
  } else if (message?.type === "STORE_YOUTUBE_PLAYER_RESPONSE") {
    operation = storeYouTubePlayerResponse(message.payload ?? {}, sender);
  } else if (message?.type === "GET_YOUTUBE_PLAYER_RESPONSE") {
    operation = getYouTubePlayerResponse(message.payload?.tabId);
  } else if (message?.type === "GET_PLAYER_RESPONSE_BY_VIDEO_ID") {
    operation = getPlayerResponseByVideoId(message.payload?.videoId);
  } else if (message?.type === "CLEAR_PLAYER_RESPONSE_BY_VIDEO_ID") {
    operation = clearPlayerResponseByVideoId(message.payload?.videoId);
  } else if (message?.type === "OFFSCREEN_JOB_EVENT") {
    operation = isOffscreenSender(sender)
      ? notifyWebsiteJob(String(message.payload?.jobId || ""), message.payload ?? {})
      : Promise.reject(new Error("허용되지 않은 작업 상태 요청입니다."));
  } else if (message?.type === "SAVE_OFFSCREEN_FILE") {
    operation = saveOffscreenFile(message.payload ?? {}, sender);
  } else if (message?.type === "FETCH_ONESIE") {
    operation = fetchOnesie(message.payload ?? {});
  } else {
    return false;
  }

  operation
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "요청 처리에 실패했습니다.",
    }));
  return true;
});

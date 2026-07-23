import assert from "node:assert/strict";
import test from "node:test";

let messageListener;
let webRequestListener;
let returnedStreamHost = "rr1---sn-test.googlevideo.com";
const fetchCalls = [];
const sessionValues = {};
const createdTabs = [];
const removedTabs = [];
const websiteMessages = [];
const offscreenMessages = [];
let offscreenCreated = false;
let requireBackgroundCapture = false;

globalThis.chrome = {
  runtime: {
    id: "test",
    getURL(path) {
      return `chrome-extension://test/${path}`;
    },
    async getContexts() {
      return offscreenCreated ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [];
    },
    async sendMessage(message) {
      offscreenMessages.push(message);
      if (message.target !== "offscreen") return undefined;
      if (message.type === "PREPARE_OFFSCREEN_JOB") {
        if (requireBackgroundCapture && !message.payload.captureDownload && !message.payload.storedPlayerResponse) {
          return { ok: true, result: { ok: false, needsBackgroundCapture: true, error: "임베드 응답 없음" } };
        }
        return {
          ok: true,
          result: {
            ok: true,
            prepared: {
              title: "자동 테스트",
              qualityOptions: [{ id: "137", label: "1080p", codec: "H.264", selected: true }],
              selectedQualityId: "137",
              formatSummary: "1080p H.264 + AAC",
            },
          },
        };
      }
      if (["START_OFFSCREEN_JOB", "SELECT_OFFSCREEN_QUALITY", "CANCEL_OFFSCREEN_JOB"].includes(message.type)) {
        return { ok: true, result: { started: true } };
      }
      return undefined;
    },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      },
    },
  },
  tabs: {
    async create(options) {
      const tab = options.url.startsWith("chrome-extension://")
        ? { id: 78, status: "complete", title: "다운로드", ...options }
        : { id: 77, status: "complete", title: "자동 테스트 - YouTube", ...options };
      createdTabs.push(tab);
      return tab;
    },
    async get(tabId) {
      return { id: tabId, status: "complete", title: "자동 테스트 - YouTube" };
    },
    async remove(tabId) {
      removedTabs.push(tabId);
    },
    async sendMessage(tabId, message) {
      websiteMessages.push({ tabId, message });
    },
    onUpdated: {
      addListener() {},
      removeListener() {},
    },
  },
  offscreen: {
    async createDocument() {
      offscreenCreated = true;
    },
  },
  downloads: {
    showDefaultFolder() {},
    async download() {
      return 1;
    },
    async search() {
      return [{ id: 1, state: "complete" }];
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  },
  scripting: {
    async executeScript({ target }) {
      if (target.tabId === 77) {
        const expires = Math.floor(Date.now() / 1000) + 3600;
        webRequestListener({
          tabId: 77,
          initiator: "https://www.youtube.com",
          url: `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${expires}&itag=137&mime=video%2Fmp4&clen=1000000&dur=10&range=0-65535`,
        });
        webRequestListener({
          tabId: 77,
          initiator: "https://www.youtube.com",
          url: `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${expires}&itag=140&mime=audio%2Fmp4&clen=100000&dur=10&range=0-65535`,
        });
      }
      return [{ result: { ready: true, title: "자동 테스트 - YouTube" } }];
    },
  },
  webRequest: {
    onBeforeRequest: {
      addListener(listener) {
        webRequestListener = listener;
      },
    },
  },
  storage: {
    session: {
      async get(key) {
        return Object.hasOwn(sessionValues, key) ? { [key]: sessionValues[key] } : {};
      },
      async set(values) {
        Object.assign(sessionValues, values);
      },
      async remove(key) {
        for (const item of Array.isArray(key) ? key : [key]) delete sessionValues[item];
      },
    },
  },
};

function responseWithUrl(body, init, url) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), init });

  if (String(url).startsWith("http://127.0.0.1:4545/")) {
    const streams = [
      {
        kind: "video",
        url: `https://${returnedStreamHost}/videoplayback?id=test-video`,
        itag: "137",
        container: "mp4",
        codec: "avc1.640028",
        height: 1080,
      },
      {
        kind: "audio",
        url: `https://${returnedStreamHost}/videoplayback?id=test-audio`,
        itag: "140",
        container: "m4a",
        codec: "mp4a.40.2",
        height: null,
      },
    ];
    return responseWithUrl(JSON.stringify({
      probe: { title: "테스트 영상", videoId: "test", streams },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }, String(url));
  }

  const bytes = new Uint8Array(64 * 1024);
  const isVideo = String(url).includes("test-video");
  return responseWithUrl(bytes, {
    status: 206,
    headers: {
      "content-type": isVideo ? "video/mp4" : "audio/mp4",
      "content-range": "bytes 0-65535/1000000",
    },
  }, String(url));
};

await import("../extension/service-worker.js");

function sendMessage(payload, type = "RUN_GOOGLEVIDEO_PROBE", sender = {}) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("응답 시간 초과")), 1_000);
    const keepsChannelOpen = messageListener({
      type,
      payload,
    }, sender, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });
    assert.equal(keepsChannelOpen, true);
  });
}

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("조건 대기 시간 초과");
}

test("영상·음성 요청을 각각 64KB Range 요청으로 보낸다", async () => {
  fetchCalls.length = 0;
  returnedStreamHost = "rr1---sn-test.googlevideo.com";

  const response = await sendMessage({
    url: "https://www.youtube.com/watch?v=test",
    rightsConfirmed: true,
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.allSucceeded, true);
  assert.equal(response.result.results.length, 2);
  assert.deepEqual(response.result.results.map((result) => result.status), [206, 206]);
  assert.deepEqual(response.result.results.map((result) => result.bytesRead), [65_536, 65_536]);
  assert.equal(fetchCalls.length, 3);
  for (const call of fetchCalls.slice(1)) {
    assert.equal(call.init.headers.Range, "bytes=0-65535");
  }
});

test("YouTube 탭의 영상·음성 요청을 세션에 포착하고 범위 파라미터를 제거한다", async () => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  webRequestListener({
    tabId: 42,
    initiator: "https://www.youtube.com",
    url: `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${expires}&itag=137&mime=video%2Fmp4&clen=1000000&dur=10&range=0-65535&rn=1&rbuf=2`,
  });
  webRequestListener({
    tabId: 42,
    initiator: "https://www.youtube.com",
    url: `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${expires}&itag=140&mime=audio%2Fmp4&clen=100000&dur=10&range=0-65535&rn=2&rbuf=3`,
  });

  const status = await sendMessage({ tabId: 42 }, "GET_CAPTURE_STATUS");
  assert.equal(status.ok, true);
  assert.equal(status.result.ready, true);
  assert.equal(status.result.video.height, 1080);
  assert.equal(status.result.audio.codec, "mp4a.40.2");

  const download = await sendMessage({
    tabId: 42,
    sourceUrl: "https://www.youtube.com/watch?v=test123",
    title: "내 테스트 - YouTube",
  }, "GET_CAPTURED_DOWNLOAD");
  assert.equal(download.ok, true);
  assert.equal(download.result.captureMode, true);
  assert.equal(download.result.title, "내 테스트");
  for (const stream of download.result.streams) {
    const url = new URL(stream.url);
    assert.equal(url.searchParams.has("range"), false);
    assert.equal(url.searchParams.has("rn"), false);
    assert.equal(url.searchParams.has("rbuf"), false);
  }
});

test("Googlevideo가 아닌 미디어 주소는 요청 전에 차단한다", async () => {
  fetchCalls.length = 0;
  returnedStreamHost = "example.com";

  const response = await sendMessage({
    url: "https://www.youtube.com/watch?v=test",
    rightsConfirmed: true,
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /허용되지 않은 미디어 주소/);
  assert.equal(fetchCalls.length, 1);
});

test("숨겨진 플레이어가 실패하면 비활성 임시 탭으로 포착하고 다운로드 탭은 열지 않는다", async () => {
  createdTabs.length = 0;
  removedTabs.length = 0;
  websiteMessages.length = 0;
  offscreenMessages.length = 0;
  requireBackgroundCapture = true;

  const response = await sendMessage({
    url: "https://www.youtube.com/watch?v=test123",
    rightsConfirmed: true,
  }, "OPEN_DIRECT_DOWNLOAD", {
    url: "http://127.0.0.1:4545/",
    tab: { id: 11, url: "http://127.0.0.1:4545/" },
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.queued, true);
  assert.equal(response.result.processingLocation, "client");
  await waitUntil(() => websiteMessages.some(({ message }) => message.payload?.state === "ready"));
  assert.equal(createdTabs.length, 1);
  assert.equal(createdTabs[0].url, "https://www.youtube.com/watch?v=test123");
  assert.equal(createdTabs[0].active, false);
  assert.deepEqual(removedTabs, [77]);
  assert.ok(offscreenMessages.some((message) => message.type === "PREPARE_OFFSCREEN_JOB"));
  assert.ok(websiteMessages.some(({ message }) => message.type === "WETUBE_JOB_EVENT"));
  requireBackgroundCapture = false;
});

test("숨겨진 플레이어가 응답하면 새 브라우저 탭을 만들지 않는다", async () => {
  createdTabs.length = 0;
  websiteMessages.length = 0;
  offscreenMessages.length = 0;
  requireBackgroundCapture = false;

  const response = await sendMessage({
    url: "https://www.youtube.com/watch?v=test123",
    rightsConfirmed: true,
  }, "PREPARE_INTEGRATED_DOWNLOAD", {
    url: "http://127.0.0.1:4545/",
    tab: { id: 12, url: "http://127.0.0.1:4545/" },
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.queued, true);
  await waitUntil(() => websiteMessages.some(({ message }) => message.payload?.state === "ready"));
  assert.equal(createdTabs.length, 0);
});

test("YouTube 메인 월드의 SABR 플레이어 응답을 탭별로 저장한다", async () => {
  const playerResponse = {
    videoDetails: { videoId: "test1234567", title: "SABR 테스트" },
    streamingData: {
      serverAbrStreamingUrl: "https://rr1---sn-test.googlevideo.com/videoplayback?sabr=1",
      adaptiveFormats: [{ itag: 137 }],
    },
    playerConfig: {
      mediaCommonConfig: {
        mediaUstreamerRequestConfig: { videoPlaybackUstreamerConfig: "test-config" },
      },
    },
  };

  const stored = await sendMessage({
    responseJson: JSON.stringify(playerResponse),
    videoId: "test1234567",
    title: "SABR 테스트",
    clientInfo: { clientName: 1, clientVersion: "2.20260723.00.00" },
  }, "STORE_YOUTUBE_PLAYER_RESPONSE", {
    tab: { id: 55, url: "https://www.youtube.com/watch?v=test1234567" },
  });
  assert.equal(stored.ok, true);
  assert.equal(stored.result.ready, true);

  const response = await sendMessage({ tabId: 55 }, "GET_YOUTUBE_PLAYER_RESPONSE");
  assert.equal(response.ok, true);
  assert.equal(response.result.videoId, "test1234567");
  assert.equal(response.result.adaptiveFormatCount, 1);
});

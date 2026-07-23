import {
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  WEBM,
} from "mediabunny";
import { preparePageSabrDownload, extractVideoId } from "./direct-extractor.js";
import { remuxSeparateInputs } from "./remux.js";
import { createSandboxClient } from "./sandbox-client.js";

const LOCAL_API = "http://127.0.0.1:4545";
const TRUSTED_RUNTIME_ORIGINS = new Set([
  "http://127.0.0.1:4545",
  "http://localhost:4545",
  "https://ourtube.kr",
  "https://www.ourtube.kr",
]);
const CACHE_BYTES = 16 * 1024 * 1024;
const TEMP_DIRECTORY = "wetube-temporary-files";

const youtubeFrame = document.querySelector("#youtube-player");
const runtimeFrame = document.querySelector("#runtime-sandbox");
const preparedJobs = new Map();
let sandbox = null;
let sandboxUrl = "";
let activeJobId = null;

function runtimeMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ target: "service-worker", type, payload });
}

function emit(jobId, event) {
  void runtimeMessage("OFFSCREEN_JOB_EVENT", { jobId, ...event }).catch(() => {});
}

function formatBytes(bytes) {
  const numericBytes = Number(bytes);
  if (!Number.isFinite(numericBytes) || numericBytes <= 0) return "크기 정보 없음";
  const units = ["B", "KB", "MB", "GB"];
  let value = numericBytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function sanitizeFilename(value) {
  const safe = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${safe || "위튜브 영상"}.mp4`;
}

function getStream(prepared, kind) {
  return prepared?.streams?.find((stream) => stream.kind === kind) || null;
}

function getPreparedSummary(prepared) {
  const video = getStream(prepared, "video");
  const audio = getStream(prepared, "audio");
  const estimatedBytes = [video?.approximateBytes, audio?.approximateBytes]
    .map(Number)
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  const qualityOptions = Array.isArray(prepared.videoOptions)
    ? prepared.videoOptions.map((option) => ({
      id: String(option.id),
      height: Number(option.height) || null,
      label: String(option.label || `${option.height || "?"}p`),
      codec: String(option.codec || "영상"),
      approximateBytes: Number(option.approximateBytes) || null,
      selected: Boolean(option.selected),
    }))
    : [];
  return {
    title: prepared.title,
    thumbnail: prepared.thumbnail || "",
    uploader: prepared.uploader || "",
    duration: Number(prepared.duration) || null,
    qualityOptions,
    selectedQualityId: qualityOptions.find((option) => option.selected)?.id || qualityOptions[0]?.id || "",
    formatSummary: `${video?.height || "?"}p ${video?.codec || "영상"} + ${audio?.codec || "음성"}`,
    estimatedBytes,
    estimatedSize: formatBytes(estimatedBytes),
  };
}

function validateRuntimeUrl(rawUrl) {
  const target = new URL(rawUrl || `${LOCAL_API}/botguard-runtime.html`);
  const isTrustedRuntime = TRUSTED_RUNTIME_ORIGINS.has(target.origin)
    && target.pathname === "/botguard-runtime.html";
  if (!isTrustedRuntime) throw new Error("허용되지 않은 브라우저 검증 실행 주소입니다.");
  return target;
}

function getSandbox(runtimeUrl) {
  const target = validateRuntimeUrl(runtimeUrl);
  if (sandbox && sandboxUrl === target.href) return sandbox;
  sandbox?.dispose();
  runtimeFrame.src = target.href;
  sandbox = createSandboxClient(runtimeFrame, { targetOrigin: target.origin });
  sandboxUrl = target.href;
  return sandbox;
}

async function waitForEmbeddedPlayerResponse(jobId, sourceUrl, timeoutMs = 20_000) {
  const videoId = extractVideoId(sourceUrl);
  await runtimeMessage("CLEAR_PLAYER_RESPONSE_BY_VIDEO_ID", { videoId });
  emit(jobId, { state: "analyzing", message: "숨겨진 YouTube 플레이어에서 영상 정보를 확인하는 중입니다…" });

  const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
  embedUrl.searchParams.set("autoplay", "1");
  embedUrl.searchParams.set("mute", "1");
  embedUrl.searchParams.set("playsinline", "1");
  embedUrl.searchParams.set("enablejsapi", "1");
  youtubeFrame.src = embedUrl.href;

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const response = await runtimeMessage("GET_PLAYER_RESPONSE_BY_VIDEO_ID", { videoId });
      if (response?.ok && response.result?.hasServerAbrUrl
        && response.result.adaptiveFormatCount > 0
        && response.result.hasUstreamerConfig) {
        return response.result;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } finally {
    youtubeFrame.src = "about:blank";
  }
  throw new Error("숨겨진 YouTube 플레이어에서 SABR 정보를 받지 못했습니다.");
}

function createNetworkInput(stream) {
  const source = new UrlSource(stream.url, {
    maxCacheSize: CACHE_BYTES,
    parallelism: 3,
    requestInit: { cache: "no-store", credentials: "omit" },
    getRetryDelay: (attempt) => attempt < 3 ? 2 ** attempt : null,
  });
  return new Input({ source, formats: [MP4, WEBM] });
}

async function prepareJob(payload) {
  const jobId = String(payload.jobId || "");
  if (!jobId || !payload.sourceUrl) throw new Error("다운로드 작업 정보가 올바르지 않습니다.");

  let prepared;
  if (payload.captureDownload) {
    prepared = payload.captureDownload;
  } else {
    let storedPlayerResponse = payload.storedPlayerResponse;
    if (!storedPlayerResponse) {
      try {
        storedPlayerResponse = await waitForEmbeddedPlayerResponse(jobId, payload.sourceUrl);
      } catch (error) {
        return {
          ok: false,
          needsBackgroundCapture: true,
          error: error instanceof Error ? error.message : "숨겨진 플레이어 분석에 실패했습니다.",
        };
      }
    }
    prepared = await preparePageSabrDownload({
      sourceUrl: payload.sourceUrl,
      storedPlayerResponse,
      sandbox: getSandbox(payload.runtimeUrl),
      onStage: (message) => emit(jobId, { state: "analyzing", message }),
    });
  }

  const video = getStream(prepared, "video");
  const audio = getStream(prepared, "audio");
  if (!video || !audio) throw new Error("영상·음성 스트림을 모두 준비하지 못했습니다.");
  preparedJobs.set(jobId, prepared);
  const summary = getPreparedSummary(prepared);
  return { ok: true, prepared: summary };
}

function selectQuality(jobId, qualityId) {
  const prepared = preparedJobs.get(jobId);
  if (!prepared) throw new Error("준비된 다운로드 작업을 찾지 못했습니다.");
  if (qualityId && typeof prepared.selectVideoFormat === "function") {
    prepared.selectVideoFormat(qualityId);
  }
  return getPreparedSummary(prepared);
}

async function createMediaInputs(prepared) {
  if (prepared.directMode) return prepared.createInputs();
  return {
    videoInput: createNetworkInput(getStream(prepared, "video")),
    audioInput: createNetworkInput(getStream(prepared, "audio")),
    abort: () => {},
  };
}

async function getTemporaryFile(jobId) {
  if (!navigator.storage?.getDirectory) {
    throw new Error("이 Chrome에서는 숨겨진 로컬 파일 처리를 지원하지 않습니다.");
  }
  await navigator.storage.persist?.().catch(() => false);
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(TEMP_DIRECTORY, { create: true });
  const name = `${jobId}.mp4`;
  const handle = await directory.getFileHandle(name, { create: true });
  return { directory, handle, name };
}

async function startJob(payload) {
  const jobId = String(payload.jobId || "");
  const prepared = preparedJobs.get(jobId);
  if (!prepared) throw new Error("준비된 다운로드 작업을 찾지 못했습니다.");
  if (activeJobId) throw new Error("다른 다운로드가 진행 중입니다.");
  if (Date.now() >= prepared.expiresAt) throw new Error("미디어 정보가 만료됐습니다. 영상을 다시 분석해 주세요.");

  selectQuality(jobId, payload.qualityId);
  activeJobId = jobId;
  const controller = new AbortController();
  prepared.abortController = controller;
  let sourceAbort = () => {};
  let temporaryFile;
  let objectUrl = "";
  let maximumWritten = 0;
  let lastProgressAt = 0;

  try {
    temporaryFile = await getTemporaryFile(jobId);
    const writable = await temporaryFile.handle.createWritable();
    const target = new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 });
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target,
    });
    output.setMetadataTags({ title: prepared.title });
    target.on("write", ({ end }) => {
      maximumWritten = Math.max(maximumWritten, end);
    });

    emit(jobId, { state: "downloading", message: "사용자 PC에서 영상·음성을 내려받아 MP4로 결합하는 중입니다…", progress: 0 });
    const media = await createMediaInputs(prepared);
    sourceAbort = media.abort;
    controller.signal.addEventListener("abort", sourceAbort, { once: true });
    await remuxSeparateInputs({
      videoInput: media.videoInput,
      audioInput: media.audioInput,
      output,
      signal: controller.signal,
      onProgress: (progress) => {
        const now = Date.now();
        if (progress < 1 && now - lastProgressAt < 150) return;
        lastProgressAt = now;
        emit(jobId, {
          state: "downloading",
          message: "사용자 PC에서 다운로드와 MP4 결합을 진행하고 있습니다…",
          progress: Math.round(progress * 1000) / 10,
          writtenBytes: maximumWritten,
        });
      },
    });

    emit(jobId, { state: "saving", message: "완성된 MP4를 Chrome 다운로드 폴더에 저장하는 중입니다…", progress: 100, writtenBytes: maximumWritten });
    const file = await temporaryFile.handle.getFile();
    objectUrl = URL.createObjectURL(file);
    const saveResponse = await runtimeMessage("SAVE_OFFSCREEN_FILE", {
      jobId,
      url: objectUrl,
      filename: sanitizeFilename(prepared.title),
    });
    if (!saveResponse?.ok) throw new Error(saveResponse?.error || "완성 파일을 저장하지 못했습니다.");
    emit(jobId, {
      state: "completed",
      message: "다운로드와 MP4 결합이 완료됐습니다.",
      progress: 100,
      writtenBytes: maximumWritten,
      filename: sanitizeFilename(prepared.title),
      downloadId: saveResponse.result?.downloadId,
    });
  } catch (error) {
    const canceled = error?.name === "AbortError" || controller.signal.aborted;
    emit(jobId, {
      state: canceled ? "canceled" : "failed",
      message: canceled
        ? "다운로드를 취소했습니다. 미완성 파일은 삭제했습니다."
        : error instanceof Error ? error.message : "다운로드에 실패했습니다.",
    });
  } finally {
    sourceAbort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (temporaryFile) {
      await temporaryFile.directory.removeEntry(temporaryFile.name).catch(() => {});
    }
    prepared.abortController = null;
    preparedJobs.delete(jobId);
    activeJobId = null;
  }
}

function cancelJob(jobId) {
  const prepared = preparedJobs.get(jobId);
  if (!prepared?.abortController) throw new Error("진행 중인 다운로드가 없습니다.");
  prepared.abortController.abort();
  return { canceled: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;

  let operation;
  if (message.type === "PREPARE_OFFSCREEN_JOB") {
    operation = prepareJob(message.payload ?? {});
  } else if (message.type === "SELECT_OFFSCREEN_QUALITY") {
    operation = Promise.resolve(selectQuality(String(message.payload?.jobId || ""), message.payload?.qualityId));
  } else if (message.type === "START_OFFSCREEN_JOB") {
    void startJob(message.payload ?? {}).catch((error) => {
      const jobId = String(message.payload?.jobId || "");
      emit(jobId, { state: "failed", message: error instanceof Error ? error.message : "다운로드를 시작하지 못했습니다." });
    });
    operation = Promise.resolve({ started: true });
  } else if (message.type === "CANCEL_OFFSCREEN_JOB") {
    operation = Promise.resolve(cancelJob(String(message.payload?.jobId || "")));
  } else {
    return false;
  }

  operation
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "숨겨진 다운로드 작업에 실패했습니다.",
    }));
  return true;
});

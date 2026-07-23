import {
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  WEBM,
} from "mediabunny";
import { prepareDirectDownload, preparePageSabrDownload } from "./direct-extractor.js";
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

const parameters = new URL(location.href).searchParams;
const sourceUrl = parameters.get("url") || "";
const mode = parameters.get("mode") || "server";
const runtimeUrl = parameters.get("runtime") || `${LOCAL_API}/botguard-runtime.html`;
const captureTabId = Number.parseInt(parameters.get("tabId") || "", 10);
const captureTitle = parameters.get("title") || "YouTube 영상";
const titleElement = document.querySelector("#video-title");
const sourceElement = document.querySelector("#source-url");
const formatElement = document.querySelector("#format-summary");
const sizeElement = document.querySelector("#size-summary");
const qualityField = document.querySelector("#quality-field");
const videoQualitySelect = document.querySelector("#video-quality");
const statusElement = document.querySelector("#status");
const progressElement = document.querySelector("#progress");
const progressTextElement = document.querySelector("#progress-text");
const writtenElement = document.querySelector("#written-size");
const prepareButton = document.querySelector("#prepare");
const downloadButton = document.querySelector("#download");
const cancelButton = document.querySelector("#cancel");
const modeNoteElement = document.querySelector("#mode-note");
const runtimeFrame = document.querySelector("#runtime-sandbox");

function getRuntimeTarget() {
  if (!["direct", "page-sabr"].includes(mode) || !runtimeUrl) {
    return { url: chrome.runtime.getURL("sandbox.html"), origin: "*" };
  }
  const target = new URL(runtimeUrl);
  const isTrustedRuntime = TRUSTED_RUNTIME_ORIGINS.has(target.origin)
    && target.pathname === "/botguard-runtime.html";
  if (!isTrustedRuntime) throw new Error("허용되지 않은 브라우저 검증 실행 주소입니다.");
  return { url: target.href, origin: target.origin };
}

const runtimeTarget = getRuntimeTarget();
runtimeFrame.src = runtimeTarget.url;
const sandbox = createSandboxClient(runtimeFrame, { targetOrigin: runtimeTarget.origin });

let preparedDownload = null;
let activeAbortController = null;
let activeSourceAbort = null;

function setStatus(message, tone = "") {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 정보 없음";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function sanitizeFilename(value) {
  const safe = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${safe || "아워튜브 영상"}.mp4`;
}

function getStream(kind) {
  return preparedDownload?.streams.find((stream) => stream.kind === kind) || null;
}

function updatePreparedSummary() {
  const video = getStream("video");
  const audio = getStream("audio");
  if (!video || !audio) return;
  formatElement.textContent = [
    `${video.height || "?"}p ${video.codec}`,
    audio.codec,
  ].join(" + ");
  const estimatedBytes = [video.approximateBytes, audio.approximateBytes]
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);
  sizeElement.textContent = formatBytes(estimatedBytes);
}

function renderQualityOptions() {
  videoQualitySelect.replaceChildren();
  const options = preparedDownload?.videoOptions;
  if (!Array.isArray(options) || options.length === 0) {
    qualityField.hidden = true;
    return;
  }

  for (const quality of options) {
    const option = document.createElement("option");
    option.value = quality.id;
    const size = Number.isFinite(quality.approximateBytes) ? ` · 약 ${formatBytes(quality.approximateBytes)}` : "";
    option.textContent = `${quality.label} · ${quality.codec}${size}`;
    option.selected = Boolean(quality.selected);
    videoQualitySelect.append(option);
  }
  videoQualitySelect.disabled = false;
  qualityField.hidden = false;
}

async function loadPreparedDownload() {
  if (mode === "capture") {
    const response = await chrome.runtime.sendMessage({
      type: "GET_CAPTURED_DOWNLOAD",
      payload: { tabId: captureTabId, sourceUrl, title: captureTitle },
    });
    if (!response?.ok) throw new Error(response?.error || "포착한 스트림을 읽지 못했습니다.");
    return response.result;
  }
  if (mode === "direct") {
    return prepareDirectDownload({
      sourceUrl,
      sandbox,
      onStage: (message) => setStatus(message),
    });
  }
  if (mode === "page-sabr") {
    const response = await chrome.runtime.sendMessage({
      type: "GET_YOUTUBE_PLAYER_RESPONSE",
      payload: { tabId: captureTabId },
    });
    if (!response?.ok || !response.result) {
      throw new Error(response?.error || "YouTube 탭의 SABR 플레이어 정보를 읽지 못했습니다.");
    }
    return preparePageSabrDownload({
      sourceUrl,
      storedPlayerResponse: response.result,
      sandbox,
      onStage: (message) => setStatus(message),
    });
  }

  const response = await fetch(`${LOCAL_API}/api/extension/download-targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl, rightsConfirmed: true }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `로컬 서버 응답 오류 (${response.status})`);
  return payload.download;
}

async function prepareDownload() {
  if (!sourceUrl) throw new Error("YouTube 영상 주소가 없습니다.");
  prepareButton.disabled = true;
  downloadButton.disabled = true;
  videoQualitySelect.disabled = true;
  qualityField.hidden = true;
  setStatus(
    ["direct", "page-sabr"].includes(mode)
      ? "확장 프로그램에서 영상을 분석하는 중입니다…"
      : "영상·음성 스트림을 확인하는 중입니다…",
  );
  try {
    preparedDownload = await loadPreparedDownload();
    const video = getStream("video");
    const audio = getStream("audio");
    if (!video || !audio) throw new Error("영상·음성 스트림을 모두 준비하지 못했습니다.");

    titleElement.textContent = preparedDownload.title;
    renderQualityOptions();
    updatePreparedSummary();
    downloadButton.disabled = false;
    setStatus("준비됐습니다. 저장 위치를 선택하면 사용자 PC에서 다운로드와 결합을 시작합니다.", "success");
  } finally {
    prepareButton.disabled = false;
  }
}

videoQualitySelect.addEventListener("change", () => {
  if (!preparedDownload?.selectVideoFormat) return;
  try {
    preparedDownload.selectVideoFormat(videoQualitySelect.value);
    updatePreparedSummary();
    setStatus("선택한 화질로 준비됐습니다. 저장 위치를 선택해 주세요.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "화질을 선택하지 못했습니다.", "error");
  }
});

function createNetworkInput(stream) {
  const source = new UrlSource(stream.url, {
    maxCacheSize: CACHE_BYTES,
    parallelism: 3,
    requestInit: { cache: "no-store", credentials: "omit" },
    getRetryDelay: (attempt) => attempt < 3 ? 2 ** attempt : null,
  });
  return new Input({ source, formats: [MP4, WEBM] });
}

async function createMediaInputs() {
  if (preparedDownload.directMode) return preparedDownload.createInputs();
  return {
    videoInput: createNetworkInput(getStream("video")),
    audioInput: createNetworkInput(getStream("audio")),
    abort: () => {},
  };
}

async function startDownload() {
  if (!preparedDownload || activeAbortController) return;
  if (Date.now() >= preparedDownload.expiresAt) {
    preparedDownload = null;
    downloadButton.disabled = true;
    throw new Error("미디어 요청 정보가 만료됐습니다. 스트림 분석을 다시 눌러 주세요.");
  }
  if (typeof window.showSaveFilePicker !== "function") {
    throw new Error("현재 Chrome에서 직접 파일 저장 기능을 사용할 수 없습니다.");
  }

  const fileHandle = await window.showSaveFilePicker({
    suggestedName: sanitizeFilename(preparedDownload.title),
    types: [{ description: "MP4 동영상", accept: { "video/mp4": [".mp4"] } }],
  });
  const fileWritable = await fileHandle.createWritable();
  const diskBridge = new WritableStream({
    write: (chunk) => fileWritable.write(chunk),
    close: () => {},
    abort: (reason) => fileWritable.abort(reason),
  });
  const target = new StreamTarget(diskBridge, { chunked: true, chunkSize: 4 * 1024 * 1024 });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target,
  });
  output.setMetadataTags({ title: preparedDownload.title });

  let maximumWritten = 0;
  target.on("write", ({ end }) => {
    maximumWritten = Math.max(maximumWritten, end);
    writtenElement.textContent = formatBytes(maximumWritten);
  });

  activeAbortController = new AbortController();
  prepareButton.disabled = true;
  downloadButton.disabled = true;
  videoQualitySelect.disabled = true;
  cancelButton.hidden = false;
  setStatus("사용자 PC에서 영상·음성을 내려받아 MP4로 결합하는 중입니다…");

  try {
    const media = await createMediaInputs();
    activeSourceAbort = media.abort;
    if (activeAbortController.signal.aborted) {
      media.abort();
      throw new DOMException("사용자가 작업을 취소했습니다.", "AbortError");
    }
    activeAbortController.signal.addEventListener("abort", media.abort, { once: true });
    await remuxSeparateInputs({
      videoInput: media.videoInput,
      audioInput: media.audioInput,
      output,
      signal: activeAbortController.signal,
      onProgress: (progress) => {
        const percent = Math.round(progress * 100);
        progressElement.value = percent;
        progressTextElement.textContent = `${percent}%`;
      },
    });
    await fileWritable.close();
    setStatus(`완료됐습니다. ${formatBytes(maximumWritten)} MP4가 사용자 PC에 저장됐습니다.`, "success");
  } catch (error) {
    await fileWritable.abort(error).catch(() => {});
    if (error?.name === "AbortError" || activeAbortController.signal.aborted) {
      setStatus("다운로드를 취소했습니다. 미완성 파일은 저장되지 않았습니다.", "warning");
    } else {
      throw error;
    }
  } finally {
    activeSourceAbort = null;
    activeAbortController = null;
    prepareButton.disabled = false;
    downloadButton.disabled = false;
    videoQualitySelect.disabled = false;
    cancelButton.hidden = true;
  }
}

prepareButton.addEventListener("click", () => {
  void prepareDownload().catch((error) => {
    setStatus(error instanceof Error ? error.message : "스트림 분석에 실패했습니다.", "error");
  });
});

downloadButton.addEventListener("click", () => {
  void startDownload().catch((error) => {
    if (error?.name !== "AbortError") {
      setStatus(error instanceof Error ? error.message : "다운로드에 실패했습니다.", "error");
    }
  });
});

cancelButton.addEventListener("click", () => {
  activeSourceAbort?.();
  activeAbortController?.abort();
});

sourceElement.textContent = sourceUrl || "주소 없음";
if (mode === "direct") {
  modeNoteElement.textContent = "로컬 서버와 YouTube 재생 탭 없이, 주소 분석·네트워크·MP4 결합을 이 Chrome에서 처리하는 실험 경로입니다.";
} else if (mode === "page-sabr") {
  prepareButton.textContent = "SABR 스트림 다시 확인";
  modeNoteElement.textContent = "YouTube 탭에서 받은 SABR 플레이어 정보로 영상·음성을 이 Chrome에서 직접 내려받고 MP4로 결합합니다.";
  void prepareDownload().catch((error) => {
    setStatus(error instanceof Error ? error.message : "SABR 스트림 확인에 실패했습니다.", "error");
  });
} else if (mode === "capture") {
  prepareButton.textContent = "포착 스트림 다시 확인";
  modeNoteElement.textContent = "자동으로 포착한 영상·음성을 이 Chrome에서 직접 다운로드하고 결합합니다. 로컬 서버는 필요 없습니다.";
  void prepareDownload().catch((error) => {
    setStatus(error instanceof Error ? error.message : "포착 스트림 확인에 실패했습니다.", "error");
  });
}

window.addEventListener("pagehide", () => sandbox.dispose(), { once: true });

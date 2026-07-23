const inspectForm = document.querySelector("#inspect-form");
const urlInput = document.querySelector("#video-url");
const rightsInput = document.querySelector("#rights-confirmed");
const inspectButton = document.querySelector("#inspect-button");
const extensionStatus = document.querySelector("#extension-status");
const message = document.querySelector("#message");
const preview = document.querySelector("#preview");
const thumbnail = document.querySelector("#thumbnail");
const uploader = document.querySelector("#uploader");
const videoTitle = document.querySelector("#video-title");
const duration = document.querySelector("#duration");
const downloadControls = document.querySelector("#download-controls");
const downloadButton = document.querySelector("#download-button");
const videoQuality = document.querySelector("#video-quality");
const progressCard = document.querySelector("#progress-card");
const progressState = document.querySelector("#progress-state");
const progressDetail = document.querySelector("#progress-detail");
const progressBar = document.querySelector("#progress-bar");
const formatSummary = document.querySelector("#format-summary");
const sizeSummary = document.querySelector("#size-summary");
const writtenSize = document.querySelector("#written-size");
const outputPath = document.querySelector("#output-path");
const cancelButton = document.querySelector("#cancel-button");
const openFolderButton = document.querySelector("#open-folder-button");

const pendingRequests = new Map();
let requestSequence = 0;
let extensionReady = false;
let activeJobId = "";
let activeJobState = "";
let preparedDownload = null;

function showMessage(text, kind = "info") {
  message.textContent = text;
  message.className = `message ${kind}`;
}

function setBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

function postExtensionMessage(type, payload = {}) {
  window.postMessage({ channel: "wetube-web", type, ...payload }, location.origin);
}

function requestExtension(action, payload = {}, timeoutMs = 120_000) {
  const requestId = String(++requestSequence);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("확장 프로그램 응답 시간이 초과되었습니다."));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timeoutId });
    postExtensionMessage(action, { requestId, payload });
  });
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

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return "길이 정보 없음";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderQualityOptions(options, selectedQualityId) {
  videoQuality.replaceChildren();
  const qualities = Array.isArray(options) ? options : [];
  if (qualities.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "자동 선택";
    videoQuality.append(option);
  } else {
    for (const quality of qualities) {
      const option = document.createElement("option");
      option.value = quality.id;
      const size = quality.approximateBytes ? ` · 약 ${formatBytes(quality.approximateBytes)}` : "";
      option.textContent = `${quality.label} · ${quality.codec}${size}`;
      option.selected = quality.id === selectedQualityId;
      videoQuality.append(option);
    }
  }
  videoQuality.disabled = false;
}

function renderPrepared(prepared) {
  preparedDownload = prepared;
  videoTitle.textContent = prepared.title || "YouTube 영상";
  uploader.textContent = prepared.uploader || "YouTube";
  duration.textContent = formatDuration(prepared.duration);
  thumbnail.src = prepared.thumbnail || "";
  thumbnail.hidden = !prepared.thumbnail;
  renderQualityOptions(prepared.qualityOptions, prepared.selectedQualityId);
  formatSummary.textContent = prepared.formatSummary || "MP4";
  sizeSummary.textContent = prepared.estimatedSize || formatBytes(prepared.estimatedBytes);
  preview.hidden = false;
  downloadControls.hidden = false;
  progressCard.hidden = false;
  downloadButton.disabled = false;
}

function resetDownloadView() {
  activeJobId = "";
  activeJobState = "";
  preparedDownload = null;
  preview.hidden = true;
  downloadControls.hidden = true;
  progressCard.hidden = true;
  videoQuality.disabled = true;
  progressBar.style.width = "0%";
  progressDetail.textContent = "0%";
  writtenSize.textContent = "0 B";
  outputPath.textContent = "";
  cancelButton.hidden = true;
}

function handleJobEvent(event) {
  if (!event?.jobId) return;
  if (activeJobId && activeJobId !== event.jobId) return;
  activeJobId ||= event.jobId;
  activeJobState = event.state || activeJobState;
  progressCard.hidden = false;

  if (event.prepared) renderPrepared(event.prepared);
  if (Number.isFinite(event.progress)) {
    const progress = Math.min(100, Math.max(0, event.progress));
    progressBar.style.width = `${progress}%`;
    progressDetail.textContent = `${progress.toFixed(progress % 1 ? 1 : 0)}%`;
  }
  if (Number.isFinite(event.writtenBytes)) writtenSize.textContent = formatBytes(event.writtenBytes);

  const stateLabels = {
    analyzing: "영상 분석 중",
    ready: "다운로드 준비 완료",
    downloading: "다운로드 및 MP4 결합 중",
    saving: "다운로드 폴더에 저장 중",
    completed: "저장 완료",
    failed: "작업 실패",
    canceled: "다운로드 취소됨",
  };
  progressState.textContent = stateLabels[event.state] || "처리 중";
  if (event.message) showMessage(event.message, event.state === "completed" || event.state === "ready" ? "success" : event.state === "failed" ? "error" : "info");

  const running = ["downloading", "saving"].includes(event.state);
  cancelButton.hidden = !running;
  videoQuality.disabled = running;
  downloadButton.disabled = running || ["completed", "failed", "canceled"].includes(event.state);

  if (["ready", "failed", "canceled"].includes(event.state)) {
    setBusy(inspectButton, false, "영상 확인 중…", "영상 내려받기");
  }

  if (event.state === "completed") {
    progressBar.style.width = "100%";
    progressDetail.textContent = "100%";
    outputPath.textContent = `저장 완료: ${event.filename || "Chrome 다운로드 폴더의 MP4 파일"}`;
    downloadButton.textContent = "다시 받으려면 영상을 재분석하세요";
  } else if (event.state === "failed" || event.state === "canceled") {
    outputPath.textContent = event.state === "canceled" ? "미완성 파일을 삭제했습니다." : "주소를 다시 분석한 뒤 재시도해 주세요.";
    inspectButton.disabled = false;
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "wetube-extension") return;
  if (event.data.type === "READY") {
    extensionReady = true;
    extensionStatus.textContent = "확장 프로그램 연결됨 · 이 화면에서 다운로드할 수 있습니다.";
    extensionStatus.classList.add("ready");
    return;
  }
  if (event.data.type === "JOB_EVENT") {
    handleJobEvent(event.data.event);
    return;
  }
  if (event.data.type !== "CLIENT_RESPONSE") return;
  const pending = pendingRequests.get(String(event.data.requestId || ""));
  if (!pending) return;
  pendingRequests.delete(String(event.data.requestId));
  clearTimeout(pending.timeoutId);
  if (event.data.ok) pending.resolve(event.data.result);
  else pending.reject(new Error(event.data.error || "확장 프로그램 요청에 실패했습니다."));
});

inspectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!rightsInput.checked) {
    showMessage("다운로드 권한 확인이 필요합니다.", "error");
    rightsInput.focus();
    return;
  }
  if (!urlInput.reportValidity()) return;
  if (!extensionReady) {
    showMessage("확장 프로그램이 연결되지 않았습니다. 설치 상태를 확인하고 홈페이지를 새로고침해 주세요.", "error");
    return;
  }

  resetDownloadView();
  setBusy(inspectButton, true, "영상 확인 중…", "영상 내려받기");
  showMessage("숨겨진 확장 프로그램 엔진에서 영상 정보를 분석하고 있습니다…");
  let queued = false;
  try {
    const result = await requestExtension("PREPARE_CLIENT_DOWNLOAD", {
      url: urlInput.value.trim(),
      rightsConfirmed: true,
    }, 30_000);
    activeJobId = result.jobId;
    queued = true;
    if (!preparedDownload && !["failed", "canceled"].includes(activeJobState)) {
      progressCard.hidden = false;
      progressState.textContent = "영상 분석 중";
      progressDetail.textContent = "0%";
      showMessage("분석 작업을 시작했습니다. 이 화면에서 준비 완료 상태를 기다려 주세요.");
    }
  } catch (error) {
    showMessage(error.message, "error");
    progressState.textContent = "영상 분석 실패";
  } finally {
    if (!queued) setBusy(inspectButton, false, "영상 확인 중…", "영상 내려받기");
  }
});

videoQuality.addEventListener("change", async () => {
  if (!activeJobId || !preparedDownload) return;
  videoQuality.disabled = true;
  try {
    const updated = await requestExtension("SELECT_CLIENT_QUALITY", {
      jobId: activeJobId,
      qualityId: videoQuality.value,
    }, 30_000);
    preparedDownload = updated;
    formatSummary.textContent = updated.formatSummary || formatSummary.textContent;
    sizeSummary.textContent = updated.estimatedSize || formatBytes(updated.estimatedBytes);
    showMessage("선택한 화질로 준비됐습니다.", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    videoQuality.disabled = false;
  }
});

downloadButton.addEventListener("click", async () => {
  if (!activeJobId || !preparedDownload) return;
  downloadButton.disabled = true;
  videoQuality.disabled = true;
  progressCard.hidden = false;
  progressState.textContent = "다운로드 시작 중";
  outputPath.textContent = "완료되면 Chrome 다운로드 폴더에 자동 저장됩니다.";
  try {
    await requestExtension("START_CLIENT_DOWNLOAD", {
      jobId: activeJobId,
      qualityId: videoQuality.value,
    }, 30_000);
  } catch (error) {
    showMessage(error.message, "error");
    downloadButton.disabled = false;
    videoQuality.disabled = false;
  }
});

cancelButton.addEventListener("click", async () => {
  if (!activeJobId) return;
  cancelButton.disabled = true;
  try {
    await requestExtension("CANCEL_CLIENT_DOWNLOAD", { jobId: activeJobId }, 30_000);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    cancelButton.disabled = false;
  }
});

openFolderButton.addEventListener("click", async () => {
  setBusy(openFolderButton, true, "여는 중…", "다운로드 폴더 열기");
  try {
    await requestExtension("OPEN_DOWNLOADS_FOLDER", {}, 30_000);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    setBusy(openFolderButton, false, "여는 중…", "다운로드 폴더 열기");
  }
});

postExtensionMessage("PING");

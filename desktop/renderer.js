const api = window.ourtubeDesktop;
const inspectForm = document.querySelector("#inspect-form");
const urlInput = document.querySelector("#video-url");
const inspectButton = document.querySelector("#inspect-button");
const engineStatus = document.querySelector("#engine-status");
const engineVersion = document.querySelector("#engine-version");
const messageElement = document.querySelector("#message");
const preview = document.querySelector("#preview");
const thumbnail = document.querySelector("#thumbnail");
const uploader = document.querySelector("#uploader");
const videoTitle = document.querySelector("#video-title");
const duration = document.querySelector("#duration");
const downloadControls = document.querySelector("#download-controls");
const videoQuality = document.querySelector("#video-quality");
const downloadButton = document.querySelector("#download-button");
const progressCard = document.querySelector("#progress-card");
const progressState = document.querySelector("#progress-state");
const progressDetail = document.querySelector("#progress-detail");
const progressBar = document.querySelector("#progress-bar");
const formatSummary = document.querySelector("#format-summary");
const sizeSummary = document.querySelector("#size-summary");
const speedSummary = document.querySelector("#speed-summary");
const outputPath = document.querySelector("#output-path");
const cancelButton = document.querySelector("#cancel-button");
const openFolderButton = document.querySelector("#open-folder-button");

let engineReady = false;
let prepared = null;
let running = false;
let progressJobId = "";
let displayedProgressPercent = 0;

function showMessage(message, tone = "info") {
  messageElement.textContent = message || "";
  messageElement.dataset.tone = tone;
}

function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 정보 없음";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  const minutes = Math.floor(value / 60);
  const remainingSeconds = Math.floor(value % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function selectedQuality() {
  return prepared?.qualityOptions.find((option) => option.id === videoQuality.value)
    || prepared?.qualityOptions[0]
    || null;
}

function updateQualitySummary() {
  const quality = selectedQuality();
  if (!quality) return;
  formatSummary.textContent = `${quality.label} · ${quality.codec} · MP4`;
  sizeSummary.textContent = quality.approximateBytes
    ? `영상 약 ${formatBytes(quality.approximateBytes)} + 음성`
    : "다운로드 전 크기 계산 중";
}

function resetPrepared() {
  prepared = null;
  preview.hidden = true;
  downloadControls.hidden = true;
  progressCard.hidden = true;
  outputPath.textContent = "";
  openFolderButton.disabled = true;
}

function renderPrepared(result) {
  prepared = result;
  videoTitle.textContent = result.title;
  uploader.textContent = result.uploader || "YouTube";
  duration.textContent = formatDuration(result.duration);
  thumbnail.src = result.thumbnail;
  thumbnail.hidden = !result.thumbnail;
  videoQuality.replaceChildren();
  for (const quality of result.qualityOptions) {
    const option = document.createElement("option");
    option.value = quality.id;
    option.textContent = [
      quality.label,
      quality.codec,
      quality.approximateBytes ? `약 ${formatBytes(quality.approximateBytes)}` : "",
    ].filter(Boolean).join(" · ");
    option.selected = quality.id === result.selectedQualityId;
    videoQuality.append(option);
  }
  preview.hidden = false;
  downloadControls.hidden = false;
  progressCard.hidden = true;
  updateQualitySummary();
}

inspectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!engineReady) {
    showMessage("로컬 다운로드 엔진이 준비되지 않았습니다.", "error");
    return;
  }
  if (!urlInput.reportValidity()) return;

  resetPrepared();
  setBusy(inspectButton, true, "영상 확인 중…", "영상 확인");
  showMessage("이 PC에서 영상 정보와 화질을 확인하고 있습니다…");
  try {
    const result = await api.inspect(urlInput.value.trim());
    renderPrepared(result);
    showMessage("화질을 선택하고 저장 위치를 지정해 주세요.", "success");
  } catch (error) {
    showMessage(error.message || "영상 정보를 확인하지 못했습니다.", "error");
  } finally {
    setBusy(inspectButton, false, "영상 확인 중…", "영상 확인");
  }
});

videoQuality.addEventListener("change", updateQualitySummary);

downloadButton.addEventListener("click", async () => {
  if (!prepared || running) return;

  running = true;
  progressCard.hidden = false;
  progressState.textContent = "다운로드 준비 중";
  progressDetail.textContent = "0%";
  progressBar.style.width = "0%";
  progressJobId = "";
  displayedProgressPercent = 0;
  speedSummary.textContent = "—";
  outputPath.textContent = "";
  cancelButton.hidden = false;
  inspectButton.disabled = true;
  videoQuality.disabled = true;
  downloadButton.disabled = true;
  showMessage("저장 위치를 선택해 주세요.");

  try {
    const result = await api.download({
      analysisId: prepared.analysisId,
      qualityId: videoQuality.value,
    });
    if (result.canceled) {
      showMessage("저장 위치 선택을 취소했습니다.");
      progressCard.hidden = true;
      return;
    }
    outputPath.textContent = result.filePath;
    openFolderButton.disabled = false;
    showMessage("다운로드와 MP4 결합이 완료됐습니다.", "success");
  } catch (error) {
    if (error?.name === "AbortError" || /취소/.test(error?.message || "")) {
      showMessage("다운로드를 취소했습니다.", "warning");
    } else {
      showMessage(error.message || "다운로드에 실패했습니다.", "error");
    }
  } finally {
    running = false;
    inspectButton.disabled = false;
    videoQuality.disabled = false;
    downloadButton.disabled = false;
    cancelButton.hidden = true;
  }
});

cancelButton.addEventListener("click", () => {
  cancelButton.disabled = true;
  void api.cancel().finally(() => {
    cancelButton.disabled = false;
  });
});

openFolderButton.addEventListener("click", () => {
  void api.openFolder();
});

engineVersion.addEventListener("click", async () => {
  engineVersion.disabled = true;
  try {
    await api.checkForUpdates(true);
  } finally {
    engineVersion.disabled = false;
  }
});

api.onProgress((event) => {
  progressCard.hidden = false;
  if (event.jobId && event.jobId !== progressJobId) {
    progressJobId = event.jobId;
    displayedProgressPercent = 0;
  }
  const labels = {
    starting: "다운로드 준비 중",
    downloading: "영상·음성 다운로드 중",
    merging: "MP4 결합 중",
    saving: "파일 저장 중",
    completed: "완료",
    canceled: "취소됨",
    failed: "실패",
  };
  const downloadLabel = event.downloadPart === "audio"
    ? "음성 다운로드 중"
    : event.downloadPart === "video"
      ? "영상 다운로드 중"
      : labels.downloading;
  progressState.textContent = event.state === "downloading"
    ? downloadLabel
    : labels[event.state] || "처리 중";
  if (Number.isFinite(event.percent)) {
    const percent = Math.min(100, Math.max(0, event.percent));
    displayedProgressPercent = Math.max(displayedProgressPercent, percent);
    progressDetail.textContent = `${displayedProgressPercent.toFixed(displayedProgressPercent % 1 ? 1 : 0)}%`;
    progressBar.style.width = `${displayedProgressPercent}%`;
  }
  if (Number(event.totalBytes) > 0) {
    const partLabel = event.state === "saving"
      ? "저장"
      : event.downloadPart === "audio"
        ? "음성"
        : event.downloadPart === "video"
          ? "영상"
          : "다운로드";
    sizeSummary.textContent = `${partLabel} ${formatBytes(event.downloadedBytes)} / ${formatBytes(event.totalBytes)}`;
  }
  speedSummary.textContent = event.state === "downloading" && event.speed
    ? `${formatBytes(event.speed)}/초`
    : "—";
  if (event.message) {
    const tone = event.state === "completed"
      ? "success"
      : event.state === "failed"
        ? "error"
        : event.state === "canceled"
          ? "warning"
          : "info";
    showMessage(event.message, tone);
  }
  if (event.filePath) {
    outputPath.textContent = event.filePath;
    openFolderButton.disabled = false;
  }
});

api.onUpdateStatus((event) => {
  const percent = Math.min(100, Math.max(0, Number(event.percent) || 0));
  if (event.state === "checking") {
    engineVersion.textContent = "업데이트 확인 중…";
    showMessage("업데이트 파일 정보를 안전하게 확인하는 중입니다.");
  } else if (event.state === "starting") {
    engineVersion.textContent = "업데이트 준비 중…";
    showMessage("업데이트 다운로드를 준비하고 있습니다.");
  } else if (event.state === "downloading") {
    engineVersion.textContent = `업데이트 ${percent.toFixed(0)}%`;
    const total = event.total ? ` / ${formatBytes(event.total)}` : "";
    showMessage(`업데이트 다운로드 중 · ${formatBytes(event.transferred)}${total}`);
  } else if (event.state === "downloaded") {
    engineVersion.textContent = `v${event.version} 설치 준비 완료`;
    showMessage("업데이트 다운로드와 무결성 검증이 완료되었습니다.", "success");
  } else if (event.state === "installing") {
    engineVersion.textContent = "업데이트 설치 중…";
    showMessage("앱을 재시작해 업데이트를 설치합니다.", "success");
  } else if (event.state === "error") {
    engineVersion.textContent = "업데이트 다시 시도";
    showMessage(event.message || "업데이트를 내려받지 못했습니다.", "error");
  }
});

api.onOpenUrl(({ url }) => {
  if (!url) return;
  urlInput.value = url;
  window.focus();
  showMessage("홈페이지에서 전달한 영상 주소를 불러왔습니다. 영상 확인을 눌러 주세요.");
});

void api.getStatus()
  .then((status) => {
    engineReady = Boolean(status.ready);
    engineVersion.textContent = `v${status.version} · 업데이트 확인`;
    engineStatus.textContent = engineReady
      ? "로컬 엔진 준비됨 · 영상 데이터는 이 PC에서만 처리됩니다."
      : "로컬 엔진 파일을 찾지 못했습니다. 앱을 다시 설치해 주세요.";
    engineStatus.dataset.ready = engineReady ? "true" : "false";
    window.setTimeout(() => {
      void api.checkForUpdates(false);
    }, 2_500);
  })
  .catch((error) => {
    engineStatus.textContent = error.message || "로컬 엔진 상태를 확인하지 못했습니다.";
    engineStatus.dataset.ready = "false";
  });

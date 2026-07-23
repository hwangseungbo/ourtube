const urlInput = document.querySelector("#video-url");
const rightsInput = document.querySelector("#rights-confirmed");
const runButton = document.querySelector("#run-probe");
const openDownloadButton = document.querySelector("#open-download");
const captureDownloadButton = document.querySelector("#capture-download");
const captureStatusElement = document.querySelector("#capture-status");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
let currentTab = null;

function setStatus(message, tone = "") {
  status.textContent = message;
  status.className = `status ${tone}`.trim();
}

function clearResults() {
  results.replaceChildren();
}

function addResult(result) {
  const card = document.createElement("article");
  card.className = "result";

  const head = document.createElement("div");
  head.className = "result-head";
  const name = document.createElement("span");
  name.textContent = result.kind === "video" ? "영상 스트림" : "음성 스트림";
  const outcome = document.createElement("span");
  outcome.className = result.ok ? "pass" : "fail";
  outcome.textContent = result.ok ? "성공" : "실패";
  head.append(name, outcome);

  const detail = document.createElement("p");
  detail.className = "detail";
  const format = [result.container, result.codec, result.height ? `${result.height}p` : ""]
    .filter(Boolean)
    .join(" · ");
  const response = result.status
    ? `HTTP ${result.status} · ${result.bytesRead.toLocaleString("ko-KR")} bytes`
    : result.error ?? "응답 없음";
  detail.textContent = `${format || `itag ${result.itag}`}\n${response}`;

  card.append(head, detail);
  results.append(card);
}

async function fillCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;
  if (typeof tab?.url !== "string") return;
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === "youtu.be" || parsed.hostname.endsWith("youtube.com")) {
      urlInput.value = tab.url;
    }
  } catch {
    // 현재 탭이 일반 URL이 아니면 사용자가 직접 입력합니다.
  }
}

async function refreshCaptureStatus() {
  if (!Number.isInteger(currentTab?.id)) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_CAPTURE_STATUS",
      payload: { tabId: currentTab.id },
    });
    if (!response?.ok) throw new Error(response?.error ?? "포착 상태를 읽지 못했습니다.");

    const capture = response.result;
    captureDownloadButton.disabled = !capture.ready;
    captureStatusElement.classList.toggle("ready", capture.ready);
    if (capture.ready) {
      const video = capture.video.height ? `${capture.video.height}p` : capture.video.codec;
      captureStatusElement.textContent = `준비됨: 영상 ${video} · 음성 ${capture.audio.codec}`;
    } else {
      const found = [capture.hasVideo ? "영상" : "", capture.hasAudio ? "음성" : ""].filter(Boolean);
      captureStatusElement.textContent = found.length > 0
        ? `${found.join("·")}만 포착됨 — 영상을 조금 더 재생해 주세요.`
        : "1080p로 영상을 5초 정도 재생한 뒤 팝업을 다시 여세요.";
    }
  } catch (error) {
    captureDownloadButton.disabled = true;
    captureStatusElement.textContent = error instanceof Error ? error.message : "포착 상태 확인 실패";
  }
}

function getValidatedRequest() {
  const url = urlInput.value.trim();
  if (!url) {
    setStatus("YouTube 영상 주소를 입력해 주세요.", "error");
    urlInput.focus();
    return null;
  }
  if (!rightsInput.checked) {
    setStatus("다운로드 권한 확인이 필요합니다.", "error");
    rightsInput.focus();
    return null;
  }
  return { url, rightsConfirmed: true };
}

runButton.addEventListener("click", async () => {
  clearResults();
  const payload = getValidatedRequest();
  if (!payload) return;

  runButton.disabled = true;
  setStatus("로컬 서버에서 스트림 주소를 확인하는 중…");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "RUN_GOOGLEVIDEO_PROBE",
      payload,
    });
    if (!response?.ok) throw new Error(response?.error ?? "확장 프로그램 응답이 없습니다.");

    for (const result of response.result.results) addResult(result);
    setStatus(
      response.result.allSucceeded
        ? "영상·음성 요청 모두 사용자 Chrome에서 성공했습니다."
        : "일부 요청이 실패했습니다. 아래 HTTP 상태를 확인하세요.",
      response.result.allSucceeded ? "success" : "error",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "테스트에 실패했습니다.";
    const localHint = message.includes("Failed to fetch")
      ? " 로컬 위튜브 서버가 실행 중인지 확인해 주세요."
      : "";
    setStatus(`${message}${localHint}`, "error");
  } finally {
    runButton.disabled = false;
  }
});

openDownloadButton.addEventListener("click", async () => {
  const payload = getValidatedRequest();
  if (!payload) return;

  const pageUrl = new URL(chrome.runtime.getURL("download.html"));
  pageUrl.searchParams.set("url", payload.url);
  await chrome.tabs.create({ url: pageUrl.href });
});

captureDownloadButton.addEventListener("click", async () => {
  const payload = getValidatedRequest();
  if (!payload || !Number.isInteger(currentTab?.id)) return;

  const pageUrl = new URL(chrome.runtime.getURL("download.html"));
  pageUrl.searchParams.set("mode", "capture");
  pageUrl.searchParams.set("tabId", String(currentTab.id));
  pageUrl.searchParams.set("url", payload.url);
  pageUrl.searchParams.set("title", currentTab.title ?? "YouTube 영상");
  await chrome.tabs.create({ url: pageUrl.href });
});

void fillCurrentTabUrl().then(refreshCaptureStatus);

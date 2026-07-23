const WEB_CHANNEL = "wetube-web";
const EXTENSION_CHANNEL = "wetube-extension";

const REQUEST_TYPES = new Map([
  ["PREPARE_CLIENT_DOWNLOAD", "PREPARE_INTEGRATED_DOWNLOAD"],
  ["START_CLIENT_DOWNLOAD", "START_INTEGRATED_DOWNLOAD"],
  ["SELECT_CLIENT_QUALITY", "SELECT_INTEGRATED_QUALITY"],
  ["CANCEL_CLIENT_DOWNLOAD", "CANCEL_INTEGRATED_DOWNLOAD"],
  ["OPEN_DOWNLOADS_FOLDER", "OPEN_DOWNLOADS_FOLDER"],
]);

function post(type, payload = {}) {
  window.postMessage({ channel: EXTENSION_CHANNEL, type, ...payload }, location.origin);
}

function isYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com"));
  } catch {
    return false;
  }
}

async function sendExtensionRequest(type, payload) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.id || typeof runtime.sendMessage !== "function") {
    throw new Error("확장 프로그램이 업데이트되었습니다. 이 홈페이지를 새로고침한 뒤 다시 시도해 주세요.");
  }
  return runtime.sendMessage({ type, payload });
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== WEB_CHANNEL) return;
  if (event.data.type === "PING") {
    post("READY");
    return;
  }

  const extensionType = REQUEST_TYPES.get(event.data.type);
  if (!extensionType) return;
  const requestId = String(event.data.requestId || "");
  const payload = event.data.payload ?? {};

  if (event.data.type === "PREPARE_CLIENT_DOWNLOAD") {
    if (!payload.rightsConfirmed) {
      post("CLIENT_RESPONSE", { requestId, action: event.data.type, ok: false, error: "다운로드 권한 확인이 필요합니다." });
      return;
    }
    if (!isYouTubeUrl(payload.url)) {
      post("CLIENT_RESPONSE", { requestId, action: event.data.type, ok: false, error: "올바른 YouTube 주소를 입력해 주세요." });
      return;
    }
  }

  Promise.resolve(sendExtensionRequest(extensionType, payload)).then((response) => {
    post("CLIENT_RESPONSE", {
      requestId,
      action: event.data.type,
      ok: Boolean(response?.ok),
      result: response?.result,
      error: response?.error,
    });
  }).catch((error) => {
    const invalidated = /Extension context invalidated|Cannot read properties of undefined/i.test(error?.message || "");
    post("CLIENT_RESPONSE", {
      requestId,
      action: event.data.type,
      ok: false,
      error: invalidated
        ? "확장 프로그램이 업데이트되었습니다. 이 홈페이지를 새로고침한 뒤 다시 시도해 주세요."
        : error instanceof Error ? error.message : "확장 프로그램 연결에 실패했습니다.",
    });
  });
});

try {
  globalThis.chrome?.runtime?.onMessage?.addListener((message) => {
    if (message?.type !== "WETUBE_JOB_EVENT") return false;
    post("JOB_EVENT", { event: message.payload });
    return false;
  });
} catch {
  // 확장 프로그램 업데이트 직후에는 홈페이지 새로고침으로 다시 연결됩니다.
}

post("READY");

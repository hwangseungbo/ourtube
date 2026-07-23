function isAllowedFetchUrl(url) {
  if (url.protocol !== "https:") return false;
  if (url.hostname === "jnn-pa.googleapis.com") {
    return [
      "/$rpc/google.internal.waa.v1.Waa/Create",
      "/$rpc/google.internal.waa.v1.Waa/GenerateIT",
    ].includes(url.pathname);
  }
  if (url.hostname === "www.youtube.com") {
    return ["/api/jnn/v1/Create", "/api/jnn/v1/GenerateIT"].includes(url.pathname);
  }
  return false;
}

export function createSandboxClient(iframe, { targetOrigin = "*" } = {}) {
  if (!(iframe instanceof HTMLIFrameElement)) {
    throw new Error("격리 실행 환경을 찾지 못했습니다.");
  }

  const pending = new Map();
  let sequence = 0;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimeout = setTimeout(() => readyReject(new Error("격리 실행 환경 시작 시간이 초과되었습니다.")), 15_000);

  function post(message) {
    iframe.contentWindow.postMessage({ channel: "wetube-parent", ...message }, targetOrigin);
  }

  async function handleFetch(message) {
    try {
      const url = new URL(message.url);
      if (!isAllowedFetchUrl(url)) {
        throw new Error("허용되지 않은 격리 네트워크 대상입니다.");
      }
      const response = await fetch(url, {
        method: message.init?.method || "GET",
        headers: message.init?.headers || [],
        body: message.init?.body || undefined,
        cache: "no-store",
        credentials: "omit",
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`검증 서버 응답 오류 (${response.status})`);
      post({
        type: "FETCH_RESULT",
        id: message.id,
        ok: true,
        response: { status: response.status, body },
      });
    } catch (error) {
      post({
        type: "FETCH_RESULT",
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : "검증 서버 요청이 실패했습니다.",
      });
    }
  }

  function onMessage(event) {
    if (event.source !== iframe.contentWindow || event.data?.channel !== "wetube-sandbox") return;
    const message = event.data;
    if (message.type === "READY") {
      clearTimeout(readyTimeout);
      readyResolve();
      return;
    }
    if (message.type === "FETCH_REQUEST") {
      void handleFetch(message);
      return;
    }
    if (message.type !== "RPC_RESULT") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "격리 작업이 실패했습니다."));
  }

  window.addEventListener("message", onMessage);

  async function call(operation, payload = {}) {
    await ready;
    const id = `rpc-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: "RPC_REQUEST", id, operation, payload });
    });
  }

  return {
    call,
    dispose() {
      clearTimeout(readyTimeout);
      window.removeEventListener("message", onMessage);
      for (const request of pending.values()) request.reject(new Error("격리 실행 환경이 종료되었습니다."));
      pending.clear();
    },
  };
}

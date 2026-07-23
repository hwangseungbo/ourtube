const CHANNEL = "wetube-youtube-main";

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.channel !== CHANNEL || event.data?.type !== "PLAYER_RESPONSE") return;

  try {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.id || typeof runtime.sendMessage !== "function") return;
    void runtime.sendMessage({
      type: "STORE_YOUTUBE_PLAYER_RESPONSE",
      payload: {
        responseJson: event.data.responseJson,
        videoId: event.data.videoId,
        title: event.data.title,
        clientInfo: event.data.clientInfo,
      },
    }).catch(() => {});
  } catch {
    // 확장이 업데이트된 기존 탭은 새로고침 후 다시 연결됩니다.
  }
});

window.postMessage({ channel: CHANNEL, type: "REQUEST_PLAYER_RESPONSE" }, location.origin);

(() => {
  const CHANNEL = "wetube-youtube-main";
  const MAX_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
  let lastFingerprint = "";

  function parseCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate === "string") {
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    return typeof candidate === "object" ? candidate : null;
  }

  function getClientInfo() {
    try {
      return {
        clientName: Number(globalThis.ytcfg?.get?.("INNERTUBE_CONTEXT_CLIENT_NAME")) || 1,
        clientVersion: String(globalThis.ytcfg?.get?.("INNERTUBE_CONTEXT_CLIENT_VERSION") || ""),
      };
    } catch {
      return { clientName: 1, clientVersion: "" };
    }
  }

  function publish(candidate, force = false) {
    const response = parseCandidate(candidate);
    const videoId = response?.videoDetails?.videoId;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId || "")) return false;

    let responseJson;
    try {
      responseJson = JSON.stringify(response);
    } catch {
      return false;
    }
    if (!responseJson || responseJson.length > MAX_RESPONSE_CHARACTERS) return false;

    const streaming = response.streamingData;
    const fingerprint = [
      videoId,
      Boolean(streaming?.serverAbrStreamingUrl),
      streaming?.adaptiveFormats?.length || 0,
      responseJson.length,
    ].join(":");
    if (!force && fingerprint === lastFingerprint) return true;
    lastFingerprint = fingerprint;

    window.postMessage({
      channel: CHANNEL,
      type: "PLAYER_RESPONSE",
      responseJson,
      videoId,
      title: String(response.videoDetails?.title || document.title || "YouTube 영상"),
      clientInfo: getClientInfo(),
    }, location.origin);
    return true;
  }

  function discover(force = false) {
    if (publish(globalThis.ytInitialPlayerResponse, force)) return;
    if (publish(globalThis.ytplayer?.config?.args?.raw_player_response, force)) return;
    try {
      publish(document.querySelector("#movie_player")?.getPlayerResponse?.(), force);
    } catch {
      // 일부 플레이어 빌드는 공개 API를 노출하지 않습니다.
    }
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = async function wetubeObservedFetch(...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const requestUrl = String(args[0]?.url || args[0] || "");
        if (requestUrl.includes("/youtubei/v1/player")) {
          void response.clone().json().then(publish).catch(() => {});
        }
      } catch {
        // 원래 fetch 응답에는 영향을 주지 않습니다.
      }
      return response;
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel !== CHANNEL || event.data?.type !== "REQUEST_PLAYER_RESPONSE") return;
    discover(true);
  });
  window.addEventListener("yt-navigate-finish", discover);
  const discoveryTimer = setInterval(discover, 500);
  setTimeout(() => clearInterval(discoveryTimer), 2 * 60 * 1000);
  discover();
})();

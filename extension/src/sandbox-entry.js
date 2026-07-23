import { BotGuardClient, parseChallengeData } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, getHeaders } from "bgutils-js/utils";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const pendingFetches = new Map();
let fetchSequence = 0;
let botguardClient = null;
let poMinter = null;
let initializationPromise = null;

function post(message) {
  parent.postMessage(message, "*");
}

function fetchThroughExtension(url, init = {}) {
  const id = `fetch-${Date.now()}-${++fetchSequence}`;
  return new Promise((resolve, reject) => {
    pendingFetches.set(id, { resolve, reject });
    post({
      channel: "wetube-sandbox",
      type: "FETCH_REQUEST",
      id,
      url: String(url),
      init: {
        method: init.method || "GET",
        headers: Array.from(new Headers(init.headers).entries()),
        body: typeof init.body === "string" ? init.body : null,
      },
    });
  });
}

async function initializeBotguard() {
  if (poMinter) return { ready: true };
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const errors = [];

    // Browser clients normally use YouTube's own JNN route. The Google RPC
    // route is kept as a fallback because availability differs by Chrome build
    // and account/network state.
    for (const useYouTubeApi of [true, false]) {
      const routeName = useYouTubeApi ? "YouTube 경로" : "Google 경로";
      try {
        const challengeResponse = await fetchThroughExtension(buildURL("Create", useYouTubeApi), {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify([REQUEST_KEY]),
        });
        const challengePayload = JSON.parse(challengeResponse.body);
        const challenge = parseChallengeData(challengePayload);
        const interpreterJavascript = challenge?.interpreterJavascript
          ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
        if (!challenge?.globalName || !challenge?.program || !interpreterJavascript) {
          throw new Error(`검증 정보 형식 ${describePayload(challengePayload)}`);
        }

        const existingScript = document.getElementById(challenge.interpreterHash);
        if (!existingScript) {
          const script = document.createElement("script");
          script.id = challenge.interpreterHash;
          script.textContent = interpreterJavascript;
          document.head.append(script);
        }

        botguardClient = await BotGuardClient.create({
          globalObject: globalThis,
          globalName: challenge.globalName,
          program: challenge.program,
        });
        const webPoSignalOutput = [];
        const botguardResponse = await botguardClient.snapshot({ webPoSignalOutput });
        const integrityResponse = await fetchThroughExtension(buildURL("GenerateIT", useYouTubeApi), {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify([REQUEST_KEY, botguardResponse]),
        });
        const integrityPayload = JSON.parse(integrityResponse.body);
        const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = Array.isArray(integrityPayload)
          ? integrityPayload
          : [];
        if (typeof integrityToken !== "string" || integrityToken.length === 0) {
          throw new Error(`토큰 응답 형식 ${describePayload(integrityPayload)}`);
        }

        poMinter = await WebPoMinter.create({
          integrityToken,
          estimatedTtlSecs,
          mintRefreshThreshold,
          websafeFallbackToken,
        }, webPoSignalOutput);
        return { ready: true, route: routeName };
      } catch (error) {
        errors.push(`${routeName}: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
        try {
          await botguardClient?.shutdown();
        } catch {
          // A failed VM may not have a shutdown function. The next route gets
          // a fresh client either way.
        }
        botguardClient = null;
        poMinter = null;
      }
    }

    throw new Error(`YouTube 무결성 토큰 초기화 실패 — ${errors.join(" / ")}`);
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

function describePayload(value) {
  if (Array.isArray(value)) {
    const types = value.slice(0, 6).map((item) => {
      if (Array.isArray(item)) return `array(${item.length})`;
      if (item === null) return "null";
      return typeof item;
    });
    return `array(${value.length})[${types.join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `object{${Object.keys(value).slice(0, 6).join(",")}}`;
  }
  return typeof value;
}

async function runOperation(operation, payload) {
  if (operation === "EVALUATE_PLAYER") {
    return new Function(payload.output)();
  }
  if (operation === "INITIALIZE_BOTGUARD") {
    return initializeBotguard();
  }
  if (operation === "MINT_PO_TOKEN") {
    await initializeBotguard();
    return { token: await poMinter.mintAsWebsafeString(payload.contentBinding) };
  }
  throw new Error(`지원하지 않는 격리 작업입니다: ${operation}`);
}

window.addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.channel !== "wetube-parent") return;

  if (event.data.type === "PING") {
    post({ channel: "wetube-sandbox", type: "READY" });
    return;
  }

  if (event.data.type === "FETCH_RESULT") {
    const pending = pendingFetches.get(event.data.id);
    if (!pending) return;
    pendingFetches.delete(event.data.id);
    if (event.data.ok) pending.resolve(event.data.response);
    else pending.reject(new Error(event.data.error || "격리 네트워크 요청이 실패했습니다."));
    return;
  }

  if (event.data.type !== "RPC_REQUEST") return;
  const { id, operation, payload } = event.data;
  Promise.resolve(runOperation(operation, payload || {}))
    .then((result) => post({
      channel: "wetube-sandbox",
      type: "RPC_RESULT",
      id,
      ok: true,
      result,
    }))
    .catch((error) => post({
      channel: "wetube-sandbox",
      type: "RPC_RESULT",
      id,
      ok: false,
      error: error instanceof Error ? error.message : "격리 작업이 실패했습니다.",
    }));
});

post({ channel: "wetube-sandbox", type: "READY" });

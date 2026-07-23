// node_modules/bgutils-js/dist/utils/constants.js
var GOOG_BASE_URL = "https://jnn-pa.googleapis.com";
var YT_BASE_URL = "https://www.youtube.com";
var GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36(KHTML, like Gecko)";

// node_modules/bgutils-js/dist/utils/helpers.js
var base64urlCharRegex = /[-_.]/g;
var base64urlToBase64Map = {
  "-": "+",
  _: "/",
  ".": "="
};
var DeferredPromise = class {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
};
var BgError = class extends TypeError {
  constructor(message, info) {
    super(message);
    this.name = "BgError";
    if (info)
      this.info = info;
  }
};
function base64ToU8(base64) {
  let base64Mod;
  if (base64urlCharRegex.test(base64)) {
    base64Mod = base64.replace(base64urlCharRegex, function(match) {
      return base64urlToBase64Map[match];
    });
  } else {
    base64Mod = base64;
  }
  base64Mod = atob(base64Mod);
  return new Uint8Array([...base64Mod].map((char) => char.charCodeAt(0)));
}
function u8ToBase64(u8, base64url = false) {
  const result = btoa(String.fromCharCode(...u8));
  if (base64url) {
    return result.replace(/\+/g, "-").replace(/\//g, "_");
  }
  return result;
}
function isBrowser() {
  const isBrowser2 = typeof window !== "undefined" && typeof window.document !== "undefined" && typeof window.document.createElement !== "undefined" && typeof window.HTMLElement !== "undefined" && typeof window.navigator !== "undefined" && typeof window.getComputedStyle === "function" && typeof window.requestAnimationFrame === "function" && typeof window.matchMedia === "function";
  const hasValidWindow = Object.getOwnPropertyDescriptor(globalThis, "window")?.get?.toString().includes("[native code]") ?? false;
  return isBrowser2 && hasValidWindow;
}
function getHeaders() {
  const headers = {
    "content-type": "application/json+protobuf",
    "x-goog-api-key": GOOG_API_KEY,
    "x-user-agent": "grpc-web-javascript/0.1"
  };
  if (!isBrowser()) {
    headers["user-agent"] = USER_AGENT;
  }
  return headers;
}
function buildURL(endpointName, useYouTubeAPI) {
  return `${useYouTubeAPI ? YT_BASE_URL : GOOG_BASE_URL}/${useYouTubeAPI ? "api/jnn/v1" : "$rpc/google.internal.waa.v1.Waa"}/${endpointName}`;
}

// node_modules/bgutils-js/dist/utils/EventEmitterLike.js
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _CustomEvent_detail;
var _EventEmitterLike_legacyListeners;
var CustomEvent = class extends Event {
  constructor(type, options) {
    super(type, options);
    _CustomEvent_detail.set(this, void 0);
    __classPrivateFieldSet(this, _CustomEvent_detail, options?.detail ?? null, "f");
  }
  get detail() {
    return __classPrivateFieldGet(this, _CustomEvent_detail, "f");
  }
};
_CustomEvent_detail = /* @__PURE__ */ new WeakMap();
var EventEmitterLike = class extends EventTarget {
  constructor() {
    super();
    _EventEmitterLike_legacyListeners.set(this, /* @__PURE__ */ new Map());
  }
  emit(type, ...args) {
    const event = new CustomEvent(type, { detail: args });
    this.dispatchEvent(event);
  }
  on(type, listener) {
    const wrapper = (ev) => {
      if (ev instanceof CustomEvent) {
        listener(...ev.detail);
      } else {
        listener(ev);
      }
    };
    __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").set(listener, { type, wrapper });
    this.addEventListener(type, wrapper);
  }
  once(type, listener) {
    const wrapper = (ev) => {
      if (ev instanceof CustomEvent) {
        listener(...ev.detail);
      } else {
        listener(ev);
      }
      this.off(type, listener);
    };
    __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").set(listener, { type, wrapper });
    this.addEventListener(type, wrapper);
  }
  off(type, listener) {
    const listenerData = __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").get(listener);
    if (listenerData && listenerData.type === type) {
      this.removeEventListener(type, listenerData.wrapper);
      __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
    }
  }
  removeAllListeners(type) {
    if (type) {
      for (const [listener, listenerData] of __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").entries()) {
        if (listenerData.type === type) {
          this.removeEventListener(type, listenerData.wrapper);
          __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
        }
      }
    } else {
      for (const [listener, listenerData] of __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").entries()) {
        this.removeEventListener(listenerData.type, listenerData.wrapper);
        __classPrivateFieldGet(this, _EventEmitterLike_legacyListeners, "f").delete(listener);
      }
    }
  }
};
_EventEmitterLike_legacyListeners = /* @__PURE__ */ new WeakMap();

// node_modules/bgutils-js/dist/core/BotGuardClient.js
var BotGuardClient = class _BotGuardClient extends EventEmitterLike {
  on(type, listener) {
    super.on(type, listener);
  }
  off(type, listener) {
    super.off(type, listener);
  }
  constructor(options) {
    super();
    this.deferredVmFunctions = new DeferredPromise();
    this.defaultTimeout = 3e3;
    if (!options.globalObject || !options.globalName || !options.program) {
      throw new BgError("Invalid options", { options });
    }
    this.userInteractionElement = options.userInteractionElement;
    this.vm = options.globalObject[options.globalName];
    this.program = options.program;
  }
  /**
   * Factory method to create and load a BotGuardClient instance.
   * @param options - Configuration options for the BotGuardClient.
   * @returns A loaded BotGuardClient instance.
   */
  static async create(options) {
    return await new _BotGuardClient(options).load();
  }
  async load() {
    if (!this.vm)
      throw new BgError("EGOU: BotGuard unavailable");
    if (!this.vm.a)
      throw new BgError("ELIU: BotGuard initialization function unavailable");
    const vmSetupCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
      this.deferredVmFunctions.resolve({
        asyncSnapshotFunction,
        shutdownFunction,
        passEventFunction,
        checkCameraFunction
      });
    };
    const logEvent = (event, elapsedTime) => {
      this.emit("record-bg-event", { event, elapsedTime });
    };
    const incrementClientErrorCount = (errorCode) => {
      this.emit("increment-client-error-count", { errorCode });
    };
    const recordPayloadSize = (payloadSize) => {
      this.emit("record-payload-size", { payloadSize });
    };
    const recordLatency = (latency, et) => {
      this.emit("record-latency", { latency, et });
    };
    const incrementEventCount = (event) => {
      this.emit("increment-bg-event-count", { event });
    };
    const loggerFunctions = [
      logEvent,
      incrementClientErrorCount,
      recordPayloadSize,
      recordLatency,
      incrementEventCount
    ];
    const vmTelemetryCallback = (latency, eventFlag1, eventFlag2) => {
      let event = "k";
      if (eventFlag1) {
        event = "h";
      } else if (eventFlag2) {
        event = "u";
      }
      incrementEventCount(event);
      logEvent(event, latency);
    };
    try {
      this.syncSnapshotFunction = await this.vm.a(this.program, vmSetupCallback, true, this.userInteractionElement, vmTelemetryCallback, [[], []], void 0, false, loggerFunctions)?.[0];
    } catch (error) {
      throw new BgError("Could not load program", { error });
    }
    return this;
  }
  /**
   * Calls a VM function with a timeout.
   * @param vmFunctionName - The name of the VM function to execute.
   * @param timeout - The timeout in milliseconds.
   * @param args - The arguments to pass to the VM function.
   */
  async execute(vmFunctionName, timeout, ...args) {
    return await Promise.race([
      (async () => {
        const vmFunctions = await this.deferredVmFunctions.promise;
        const vmFunction = vmFunctions[vmFunctionName];
        if (!vmFunction)
          throw new BgError(`${vmFunctionName} function not found`);
        return vmFunction(...args);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new BgError("VM operation timed out")), timeout))
    ]);
  }
  /**
   * Takes a snapshot asynchronously.
   * @returns The snapshot result.
   * @example
   * ```ts
   * const result = await botguard.snapshot({
   *   contentBinding: {
   *     c: "a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo",
   *     e: "ENGAGEMENT_TYPE_VIDEO_LIKE",
   *     encryptedVideoId: "P-vC09ZJcnM"
   *    }
   * });
   *
   * console.log(result);
   * ```
   */
  async snapshot(args, timeout = this.defaultTimeout) {
    return await new Promise(async (resolve, reject) => {
      await this.execute("asyncSnapshotFunction", timeout, (response) => resolve(response), [
        args.contentBinding,
        args.signedTimestamp,
        args.webPoSignalOutput,
        args.skipPrivacyBuffer
      ]).catch(reject);
    });
  }
  /**
   * Passes an event to the VM.
   */
  async passEvent(args, timeout = this.defaultTimeout) {
    return this.execute("passEventFunction", timeout, args);
  }
  /**
   * Checks the "camera".
   */
  async checkCamera(args, timeout = this.defaultTimeout) {
    return this.execute("checkCameraFunction", timeout, args);
  }
  /**
   * Shuts down the VM. Once called, the VM is no longer usable.
   */
  async shutdown(timeout = this.defaultTimeout) {
    return this.execute("shutdownFunction", timeout);
  }
  /**
   * Takes a snapshot synchronously.
   * @returns The snapshot result.
   */
  async snapshotSynchronous(args) {
    if (!this.syncSnapshotFunction)
      throw new BgError("Synchronous snapshot function not found");
    return this.syncSnapshotFunction([
      args.contentBinding,
      args.signedTimestamp,
      args.webPoSignalOutput,
      args.skipPrivacyBuffer
    ]);
  }
};

// node_modules/bgutils-js/dist/core/ChallengeFetcher.js
function parseChallengeData(rawData) {
  let challengeData = [];
  if (rawData.length > 1 && typeof rawData[1] === "string") {
    const descrambled = descrambleChallenge(rawData[1]);
    challengeData = JSON.parse(descrambled || "[]");
  } else if (rawData.length && typeof rawData[0] === "object") {
    challengeData = rawData[0];
  }
  const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;
  const privateDoNotAccessOrElseSafeScriptWrappedValue = Array.isArray(wrappedScript) ? wrappedScript.find((value) => value && typeof value === "string") : void 0;
  const privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = Array.isArray(wrappedUrl) ? wrappedUrl.find((value) => value && typeof value === "string") : void 0;
  const clientSideBgChallenge = {
    messageId,
    interpreterHash,
    program,
    globalName,
    clientExperimentsStateBlob
  };
  if (privateDoNotAccessOrElseSafeScriptWrappedValue) {
    clientSideBgChallenge.interpreterJavascript = {
      privateDoNotAccessOrElseSafeScriptWrappedValue
    };
  }
  if (privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
    clientSideBgChallenge.interpreterUrl = {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
    };
  }
  return clientSideBgChallenge;
}
function descrambleChallenge(scrambledChallenge) {
  const buffer = base64ToU8(scrambledChallenge);
  if (buffer.length)
    return new TextDecoder().decode(buffer.map((b) => b + 97));
}

// node_modules/bgutils-js/dist/core/WebPoMinter.js
var WebPoMinter = class _WebPoMinter {
  constructor(mintCallback) {
    this.mintCallback = mintCallback;
  }
  /**
   * Factory method to create a WebPoMinter instance.
   * @param integrityTokenResponse - The integrity token response object.
   * @param webPoSignalOutput - The output array containing the minter function.
   */
  static async create(integrityTokenResponse, webPoSignalOutput) {
    const getMinter = webPoSignalOutput[0];
    if (!getMinter)
      throw new BgError("PMD:Undefined");
    if (!integrityTokenResponse.integrityToken)
      throw new BgError("No integrity token provided", { integrityTokenResponse });
    const mintCallback = await getMinter(base64ToU8(integrityTokenResponse.integrityToken));
    if (!(mintCallback instanceof Function))
      throw new BgError("APF:Failed");
    return new _WebPoMinter(mintCallback);
  }
  /**
   * Mints a proof and returns it as a web-safe base64 string.
   * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
   */
  async mintAsWebsafeString(contentBinding) {
    return u8ToBase64(await this.mint(contentBinding), true);
  }
  /**
   * Mints a proof and returns it as a Uint8Array.
   * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
   */
  async mint(contentBinding) {
    const result = await this.mintCallback(new TextEncoder().encode(contentBinding));
    if (!result)
      throw new BgError("YNJ:Undefined");
    if (!(result instanceof Uint8Array))
      throw new BgError("ODM:Invalid");
    return result;
  }
};

// extension/src/sandbox-entry.js
var REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
var pendingFetches = /* @__PURE__ */ new Map();
var fetchSequence = 0;
var botguardClient = null;
var poMinter = null;
var initializationPromise = null;
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
        body: typeof init.body === "string" ? init.body : null
      }
    });
  });
}
async function initializeBotguard() {
  if (poMinter) return { ready: true };
  if (initializationPromise) return initializationPromise;
  initializationPromise = (async () => {
    const errors = [];
    for (const useYouTubeApi of [true, false]) {
      const routeName = useYouTubeApi ? "YouTube \uACBD\uB85C" : "Google \uACBD\uB85C";
      try {
        const challengeResponse = await fetchThroughExtension(buildURL("Create", useYouTubeApi), {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify([REQUEST_KEY])
        });
        const challengePayload = JSON.parse(challengeResponse.body);
        const challenge = parseChallengeData(challengePayload);
        const interpreterJavascript = challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
        if (!challenge?.globalName || !challenge?.program || !interpreterJavascript) {
          throw new Error(`\uAC80\uC99D \uC815\uBCF4 \uD615\uC2DD ${describePayload(challengePayload)}`);
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
          program: challenge.program
        });
        const webPoSignalOutput = [];
        const botguardResponse = await botguardClient.snapshot({ webPoSignalOutput });
        const integrityResponse = await fetchThroughExtension(buildURL("GenerateIT", useYouTubeApi), {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify([REQUEST_KEY, botguardResponse])
        });
        const integrityPayload = JSON.parse(integrityResponse.body);
        const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = Array.isArray(integrityPayload) ? integrityPayload : [];
        if (typeof integrityToken !== "string" || integrityToken.length === 0) {
          throw new Error(`\uD1A0\uD070 \uC751\uB2F5 \uD615\uC2DD ${describePayload(integrityPayload)}`);
        }
        poMinter = await WebPoMinter.create({
          integrityToken,
          estimatedTtlSecs,
          mintRefreshThreshold,
          websafeFallbackToken
        }, webPoSignalOutput);
        return { ready: true, route: routeName };
      } catch (error) {
        errors.push(`${routeName}: ${error instanceof Error ? error.message : "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958"}`);
        try {
          await botguardClient?.shutdown();
        } catch {
        }
        botguardClient = null;
        poMinter = null;
      }
    }
    throw new Error(`YouTube \uBB34\uACB0\uC131 \uD1A0\uD070 \uCD08\uAE30\uD654 \uC2E4\uD328 \u2014 ${errors.join(" / ")}`);
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
  throw new Error(`\uC9C0\uC6D0\uD558\uC9C0 \uC54A\uB294 \uACA9\uB9AC \uC791\uC5C5\uC785\uB2C8\uB2E4: ${operation}`);
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
    else pending.reject(new Error(event.data.error || "\uACA9\uB9AC \uB124\uD2B8\uC6CC\uD06C \uC694\uCCAD\uC774 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."));
    return;
  }
  if (event.data.type !== "RPC_REQUEST") return;
  const { id, operation, payload } = event.data;
  Promise.resolve(runOperation(operation, payload || {})).then((result) => post({
    channel: "wetube-sandbox",
    type: "RPC_RESULT",
    id,
    ok: true,
    result
  })).catch((error) => post({
    channel: "wetube-sandbox",
    type: "RPC_RESULT",
    id,
    ok: false,
    error: error instanceof Error ? error.message : "\uACA9\uB9AC \uC791\uC5C5\uC774 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."
  }));
});
post({ channel: "wetube-sandbox", type: "READY" });

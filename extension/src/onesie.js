import {
  CompressionType,
  OnesieHeader,
  OnesieHeaderType,
  OnesieInnertubeRequest,
  OnesieInnertubeResponse,
  OnesieProxyStatus,
  OnesieRequest,
  SabrError,
  UMPPartId,
} from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";
import { base64ToU8 } from "googlevideo/utils";
import { Constants } from "youtubei.js/web";

async function fetchWithContext(label, input, init) {
  const target = new URL(typeof input === "string" ? input : input.url);
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
    throw new Error(`${label} 연결 실패 (${target.hostname}): ${detail}`);
  }
}

function extractJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("YouTube TV 설정 응답이 올바르지 않습니다.");
  return JSON.parse(text.slice(start));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readFetchBodyTolerantly(response) {
  if (!response.body) return { bytes: new Uint8Array(await response.arrayBuffer()), incomplete: false };
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let incomplete = false;
  while (true) {
    let result;
    try {
      result = await reader.read();
    } catch {
      incomplete = true;
      break;
    }
    if (result.done) break;
    if (!result.value?.byteLength) continue;
    chunks.push(result.value);
    totalBytes += result.value.byteLength;
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, incomplete };
}

async function encryptRequest(clientKey, data) {
  if (!(clientKey instanceof Uint8Array) || clientKey.length !== 32) {
    throw new Error("YouTube Onesie 암호화 키가 올바르지 않습니다.");
  }
  const aesKey = await crypto.subtle.importKey(
    "raw",
    clientKey.slice(0, 16),
    { name: "AES-CTR", length: 128 },
    false,
    ["encrypt"],
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    clientKey.slice(16, 32),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: iv, length: 128 },
    aesKey,
    data,
  ));
  const signedData = new Uint8Array(encrypted.length + iv.length);
  signedData.set(encrypted);
  signedData.set(iv, encrypted.length);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, signedData));
  return { encrypted, hmac, iv };
}

export async function getOnesieConfig() {
  const response = await fetchWithContext(
    "YouTube TV 설정",
    "https://www.youtube.com/tv_config?action_get_config=true&client=lb4&theme=cl",
    {
    cache: "no-store",
    credentials: "omit",
    },
  );
  if (!response.ok) throw new Error(`YouTube TV 설정 요청 오류 (${response.status})`);
  const config = extractJson(await response.text());
  const onesie = config.webPlayerContextConfig
    ?.WEB_PLAYER_CONTEXT_CONFIG_ID_LIVING_ROOM_WATCH
    ?.onesieHotConfig;
  if (!onesie) throw new Error("YouTube Onesie 설정을 찾지 못했습니다.");
  return {
    clientKeyData: base64ToU8(onesie.clientKey),
    encryptedClientKey: base64ToU8(onesie.encryptedClientKey),
    onesieUstreamerConfig: base64ToU8(onesie.onesieUstreamerConfig),
    baseUrl: onesie.baseUrl,
  };
}

async function getRedirectorUrl() {
  const randomId = Math.round(Math.random() * 100_000);
  const response = await fetchWithContext(
    "Googlevideo 리다이렉터",
    `https://redirector.googlevideo.com/initplayback?source=youtube&itag=0&pvi=0&pai=0&owc=yes&cmo:sensitive_content=yes&alr=yes&id=${randomId}`,
    { cache: "no-store", credentials: "omit" },
  );
  if (!response.ok) throw new Error(`Googlevideo 리다이렉터 오류 (${response.status})`);
  const url = (await response.text()).trim();
  if (!url.startsWith("https://")) throw new Error("Googlevideo 리다이렉터 주소가 올바르지 않습니다.");
  return url;
}

function getClientNameId(context) {
  const id = Constants.CLIENT_NAME_IDS[context.client.clientName];
  if (!id) throw new Error(`지원하지 않는 YouTube 클라이언트입니다: ${context.client.clientName}`);
  return Number.parseInt(id, 10);
}

async function prepareRequest({ clientConfig, context, player, videoId }) {
  const innertubeBody = {
    context,
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
    playbackContext: {
      adPlaybackContext: { pyv: true },
      contentPlaybackContext: {
        signatureTimestamp: player?.signature_timestamp,
      },
    },
  };
  const innerRequest = OnesieInnertubeRequest.encode({
    url: "https://youtubei.googleapis.com/youtubei/v1/player?key=AIzaSyDCU8hByM-4DrUqRUYnGn-3llEO78bcxq8&$fields=playerConfig,storyboards,captions,playabilityStatus,streamingData,responseContext.mainAppWebResponseContext.datasyncId,videoDetails.isLive,videoDetails.isLiveContent,videoDetails.title,videoDetails.author,videoDetails.thumbnail",
    headers: [
      { name: "Content-Type", value: "application/json" },
      { name: "User-Agent", value: context.client.userAgent || "" },
      { name: "X-Goog-Visitor-Id", value: context.client.visitorData || "" },
    ],
    body: JSON.stringify(innertubeBody),
    proxiedByTrustedBandaid: true,
    skipResponseEncryption: true,
  }).finish();
  const { encrypted, hmac, iv } = await encryptRequest(clientConfig.clientKeyData, innerRequest);
  const body = OnesieRequest.encode({
    urls: [],
    innertubeRequest: {
      iv,
      hmac,
      enableCompression: true,
      encryptedClientKey: clientConfig.encryptedClientKey,
      encryptedOnesieInnertubeRequest: encrypted,
      serializeResponseAsJson: true,
      ustreamerFlags: { sendVideoPlaybackConfig: false },
    },
    streamerContext: {
      sabrContexts: [],
      unsentSabrContexts: [],
      clientInfo: {
        clientName: getClientNameId(context),
        clientVersion: context.client.clientVersion,
      },
    },
    bufferedRanges: [],
    onesieUstreamerConfig: clientConfig.onesieUstreamerConfig,
  }).finish();

  const encodedVideoId = Array.from(base64ToU8(videoId), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { body, encodedVideoId };
}

function parseOnesieResponse(buffer) {
  const reader = new UmpReader(new CompositeBuffer([new Uint8Array(buffer)]));
  const headers = [];
  const partTypes = [];
  const sabrErrors = [];
  const partialPart = reader.read((part) => {
    partTypes.push(part.type);
    const data = part.data.chunks[0];
    if (part.type === UMPPartId.ONESIE_HEADER) {
      headers.push(OnesieHeader.decode(data));
    } else if (part.type === UMPPartId.ONESIE_DATA) {
      if (headers.length > 0) headers[headers.length - 1].data = data;
    } else if (part.type === UMPPartId.SABR_ERROR) {
      const error = SabrError.decode(data);
      sabrErrors.push(error);
      console.warn("[WeTube SABR]", error);
    }
  });
  return {
    playerHeader: headers.find((header) => header.type === OnesieHeaderType.ONESIE_PLAYER_RESPONSE),
    partTypes,
    headerTypes: headers.map((header) => header.type),
    headerDetails: headers.map((header) => ({
      type: header.type,
      dataBytes: header.data?.byteLength || 0,
      dataHex: header.data ? Array.from(header.data, (byte) => byte.toString(16).padStart(2, "0")).join("") : "",
      hasCryptoParams: Boolean(header.cryptoParams),
      videoId: header.videoId || "",
      itag: header.itag || "",
    })),
    sabrErrors,
    partialPart: partialPart ? { type: partialPart.type, size: partialPart.size } : null,
  };
}

async function requestOnesieBytes(url, body) {
  if (globalThis.chrome?.runtime?.sendMessage) {
    const proxyResponse = await chrome.runtime.sendMessage({
      type: "FETCH_ONESIE",
      payload: {
        url,
        bodyBase64: bytesToBase64(body),
      },
    });
    if (!proxyResponse?.ok) {
      throw new Error(proxyResponse?.error || "YouTube Onesie 프록시 요청이 실패했습니다.");
    }
    return {
      bytes: base64ToBytes(proxyResponse.result?.bodyBase64 || ""),
      incomplete: Boolean(proxyResponse.result?.incomplete),
    };
  }

  const response = await fetchWithContext("YouTube Onesie", url, {
    method: "POST",
    body,
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`YouTube Onesie 응답 오류 (${response.status})`);
  return readFetchBodyTolerantly(response);
}

export async function getOnesiePlayerResponse({ clientConfig, context, player, videoId }) {
  const { body, encodedVideoId } = await prepareRequest({ clientConfig, context, player, videoId });
  const redirectorUrl = await getRedirectorUrl();
  const origin = redirectorUrl.split("/initplayback")[0];
  const requestUrl = `${origin}${clientConfig.baseUrl}&id=${encodedVideoId}&cmo:sensitive_content=yes&opr=1&osts=0&por=1&rn=0`;
  console.debug("[WeTube Onesie]", {
    host: new URL(requestUrl).host,
    requestBytes: body.byteLength,
  });
  const responseBody = await requestOnesieBytes(requestUrl, body);
  const responseBytes = responseBody.bytes;
  const incomplete = responseBody.incomplete;
  if (responseBytes.length === 0) throw new Error("YouTube Onesie 응답 본문이 비어 있습니다.");
  const parsedResponse = parseOnesieResponse(responseBytes.buffer);

  const { playerHeader } = parsedResponse;
  if (!playerHeader?.cryptoParams || !playerHeader.data) {
    console.warn("[WeTube Onesie] 플레이어 응답 진단", parsedResponse.headerDetails);
    const sabrSummary = parsedResponse.sabrErrors
      .map((error) => `${error.type || "unknown"}/${error.code || 0}`)
      .join(",") || "none";
    const partialSummary = parsedResponse.partialPart
      ? `${parsedResponse.partialPart.type}:${parsedResponse.partialPart.size}`
      : "none";
    throw new Error(
      `YouTube Onesie 플레이어 응답을 찾지 못했습니다. ` +
      `(bytes=${responseBytes.length}, incomplete=${incomplete}, parts=${parsedResponse.partTypes.join(",") || "none"}, ` +
      `headers=${parsedResponse.headerTypes.join(",") || "none"}, sabr=${sabrSummary}, partial=${partialSummary})`,
    );
  }
  let responseData = playerHeader.data;
  if (playerHeader.cryptoParams.compressionType === CompressionType.GZIP) {
    const decompressed = new Blob([responseData]).stream().pipeThrough(new DecompressionStream("gzip"));
    responseData = new Uint8Array(await new Response(decompressed).arrayBuffer());
  }
  const innerResponse = OnesieInnertubeResponse.decode(responseData);
  if (innerResponse.onesieProxyStatus !== OnesieProxyStatus.OK || innerResponse.httpStatus !== 200) {
    throw new Error(`YouTube Onesie 내부 응답 오류 (${innerResponse.httpStatus})`);
  }
  return JSON.parse(new TextDecoder().decode(innerResponse.body));
}

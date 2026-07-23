import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat, EnabledTrackTypes } from "googlevideo/utils";
import { Input, MP4, ReadableStreamSource, WEBM } from "mediabunny";
import { Constants, Innertube, Platform, YT } from "youtubei.js/web";
import { getOnesieConfig, getOnesiePlayerResponse } from "./onesie.js";

const STREAM_CACHE_BYTES = 32 * 1024 * 1024;

async function runStage(label, operation) {
  try {
    return await operation();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "알 수 없는 오류";
    throw new Error(`${label} 실패: ${detail}`);
  }
}

export function extractVideoId(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (host.endsWith("youtube.com") && url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
  else if (host.endsWith("youtube.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1] || "";
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error("올바른 YouTube 영상 주소를 입력해 주세요.");
  }
  return videoId;
}

function getFormatPreference(format) {
  const mimeType = format.mimeType || "";
  if (/video\/mp4/i.test(mimeType) && /avc1/i.test(mimeType)) return 3;
  if (/video\/mp4/i.test(mimeType)) return 2;
  return 1;
}

function getVideoFormatOptions(formats) {
  const videoFormats = formats
    .filter((format) => format.mimeType?.startsWith("video/"))
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  const byHeight = new Map();
  for (const format of videoFormats) {
    const key = format.height || format.qualityLabel || format.itag;
    const current = byHeight.get(key);
    if (!current
      || getFormatPreference(format) > getFormatPreference(current)
      || (getFormatPreference(format) === getFormatPreference(current)
        && (format.bitrate || 0) > (current.bitrate || 0))) {
      byHeight.set(key, format);
    }
  }
  return [...byHeight.values()].sort(
    (a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0),
  );
}

function chooseFormats(formats) {
  const videoFormats = getVideoFormatOptions(formats);
  const audioFormats = formats
    .filter((format) => format.mimeType?.startsWith("audio/"))
    .sort((a, b) => {
      const originalDelta = Number(Boolean(b.isOriginal)) - Number(Boolean(a.isOriginal));
      return originalDelta || (b.bitrate || 0) - (a.bitrate || 0);
    });

  const videoFormat = videoFormats.find((format) => /video\/mp4/i.test(format.mimeType) && /avc1/i.test(format.mimeType))
    || videoFormats.find((format) => /video\/mp4/i.test(format.mimeType))
    || videoFormats[0];
  const audioFormat = audioFormats.find((format) => /audio\/mp4/i.test(format.mimeType) && /mp4a/i.test(format.mimeType))
    || audioFormats.find((format) => /audio\/mp4/i.test(format.mimeType))
    || audioFormats[0];
  if (!videoFormat || !audioFormat) throw new Error("결합 가능한 영상·음성 형식을 찾지 못했습니다.");
  return { videoFormat, audioFormat, videoFormats };
}

function getCodecLabel(mimeType = "") {
  const codec = /codecs="([^"]+)"/i.exec(mimeType)?.[1]?.split(",")[0]?.trim() || "";
  if (/^avc1/i.test(codec)) return "H.264";
  if (/^av01/i.test(codec)) return "AV1";
  if (/^(vp09|vp9)/i.test(codec)) return "VP9";
  return codec || "영상";
}

function getClientInfo(context) {
  const clientName = Constants.CLIENT_NAME_IDS[context.client.clientName];
  if (!clientName) throw new Error(`지원하지 않는 YouTube 클라이언트입니다: ${context.client.clientName}`);
  return {
    clientName: Number.parseInt(clientName, 10),
    clientVersion: context.client.clientVersion,
  };
}

function getPreferredClientInfo(context, capturedClientInfo) {
  const clientName = Number(capturedClientInfo?.clientName);
  const clientVersion = String(capturedClientInfo?.clientVersion || "");
  if (Number.isInteger(clientName) && clientName > 0 && clientVersion) {
    return { clientName, clientVersion };
  }
  return getClientInfo(context);
}

function createInput(stream) {
  return new Input({
    source: new ReadableStreamSource(stream, { maxCacheSize: STREAM_CACHE_BYTES }),
    formats: [MP4, WEBM],
  });
}

async function createYouTubeSession(sandbox) {
  Platform.shim.eval = async (data) => sandbox.call("EVALUATE_PLAYER", { output: data.output });
  return Innertube.create({
    lang: "ko",
    location: "KR",
    enable_session_cache: true,
  });
}

async function prepareSabrResponseDownload({
  sourceUrl,
  sandbox,
  onStage,
  youtube,
  rawPlayerResponse,
  capturedClientInfo,
}) {
  const videoId = extractVideoId(sourceUrl);
  const info = new YT.VideoInfo([{ data: rawPlayerResponse }], youtube.actions, "");
  if (info.playability_status?.status !== "OK") {
    throw new Error(info.playability_status?.reason || "이 영상은 현재 재생할 수 없습니다.");
  }
  if (info.basic_info.is_live || info.basic_info.is_post_live_dvr) {
    throw new Error("현재 실시간·방송 종료 영상은 직접 다운로드를 지원하지 않습니다.");
  }

  const serverAbrUrl = info.streaming_data?.server_abr_streaming_url;
  const ustreamerConfig = info.player_config
    ?.media_common_config
    ?.media_ustreamer_request_config
    ?.video_playback_ustreamer_config;
  const formats = info.streaming_data?.adaptive_formats?.map(buildSabrFormat) || [];
  if (!serverAbrUrl || !ustreamerConfig || formats.length === 0) {
    throw new Error("YouTube SABR 다운로드 정보를 받지 못했습니다.");
  }

  onStage("SABR 주소를 복호화하는 중입니다…");
  const serverAbrStreamingUrl = await runStage(
    "YouTube SABR 주소 복호화",
    () => youtube.session.player.decipher(serverAbrUrl),
  );
  onStage("영상 요청 토큰을 만드는 중입니다…");
  const tokenResult = await runStage(
    "YouTube 영상 요청 토큰",
    () => sandbox.call("MINT_PO_TOKEN", { contentBinding: videoId }),
  );
  if (!tokenResult?.token) throw new Error("YouTube 미디어 요청 토큰을 만들지 못했습니다.");
  const { videoFormat, audioFormat, videoFormats } = chooseFormats(formats);
  let selectedVideoFormat = videoFormat;
  const videoStreamSummary = {
    kind: "video",
    codec: selectedVideoFormat.mimeType || "video",
    height: selectedVideoFormat.height,
    approximateBytes: selectedVideoFormat.contentLength,
  };
  const videoOptions = videoFormats.map((format) => ({
    id: String(format.itag),
    height: format.height || null,
    label: format.qualityLabel || `${format.height || "?"}p`,
    codec: getCodecLabel(format.mimeType),
    approximateBytes: format.contentLength,
    selected: format.itag === selectedVideoFormat.itag,
  }));

  return {
    videoId,
    title: info.basic_info.title || "YouTube 영상",
    thumbnail: info.basic_info.thumbnail?.at?.(-1)?.url || info.basic_info.thumbnail?.[0]?.url || "",
    uploader: info.basic_info.author || "",
    duration: Number(info.basic_info.duration) || null,
    expiresAt: Date.now() + 30 * 60 * 1000,
    directMode: true,
    streams: [
      videoStreamSummary,
      {
        kind: "audio",
        codec: audioFormat.mimeType || "audio",
        approximateBytes: audioFormat.contentLength,
      },
    ],
    videoOptions,
    selectVideoFormat(formatId) {
      const selected = videoFormats.find((format) => String(format.itag) === String(formatId));
      if (!selected) throw new Error("선택한 영상 화질을 찾지 못했습니다.");
      selectedVideoFormat = selected;
      for (const option of videoOptions) option.selected = option.id === String(selected.itag);
      Object.assign(videoStreamSummary, {
        codec: selected.mimeType || "video",
        height: selected.height,
        approximateBytes: selected.contentLength,
      });
    },
    createInputs() {
      const sabrStream = new SabrStream({
        formats,
        serverAbrStreamingUrl,
        videoPlaybackUstreamerConfig: ustreamerConfig,
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store", credentials: "omit" }),
        poToken: tokenResult.token,
        clientInfo: getPreferredClientInfo(youtube.session.context, capturedClientInfo),
      });
      return sabrStream.start({
        videoFormat: selectedVideoFormat,
        audioFormat,
        enabledTrackTypes: EnabledTrackTypes.VIDEO_AND_AUDIO,
      }).then(({ videoStream, audioStream }) => ({
        videoInput: createInput(videoStream),
        audioInput: createInput(audioStream),
        abort: () => sabrStream.abort(),
      }));
    },
  };
}

export async function prepareDirectDownload({ sourceUrl, sandbox, onStage = () => {} }) {
  const videoId = extractVideoId(sourceUrl);

  onStage("YouTube 클라이언트 세션을 준비하는 중입니다…");
  const youtube = await runStage("YouTube 클라이언트 세션", () => createYouTubeSession(sandbox));

  onStage("YouTube Onesie 설정을 받는 중입니다…");
  const clientConfig = await runStage("YouTube Onesie 설정", () => getOnesieConfig());

  onStage("YouTube 브라우저 검증 토큰을 준비하는 중입니다…");
  await runStage("YouTube 브라우저 검증", () => sandbox.call("INITIALIZE_BOTGUARD"));

  onStage("고화질 영상·음성 형식을 확인하는 중입니다…");
  const rawPlayerResponse = await runStage("YouTube Onesie 플레이어", () => getOnesiePlayerResponse({
    clientConfig,
    context: youtube.session.context,
    player: youtube.session.player,
    videoId,
  }));
  return prepareSabrResponseDownload({ sourceUrl, sandbox, onStage, youtube, rawPlayerResponse });
}

export async function preparePageSabrDownload({
  sourceUrl,
  storedPlayerResponse,
  sandbox,
  onStage = () => {},
}) {
  const expectedVideoId = extractVideoId(sourceUrl);
  if (!storedPlayerResponse || storedPlayerResponse.videoId !== expectedVideoId) {
    throw new Error("YouTube 탭에서 받은 플레이어 정보가 현재 영상과 일치하지 않습니다.");
  }

  let rawPlayerResponse;
  try {
    rawPlayerResponse = JSON.parse(storedPlayerResponse.responseJson);
  } catch {
    throw new Error("YouTube 탭의 플레이어 응답을 읽지 못했습니다.");
  }

  onStage("YouTube 클라이언트 세션을 준비하는 중입니다…");
  const youtube = await runStage("YouTube 클라이언트 세션", () => createYouTubeSession(sandbox));
  onStage("YouTube 브라우저 검증 토큰을 준비하는 중입니다…");
  await runStage("YouTube 브라우저 검증", () => sandbox.call("INITIALIZE_BOTGUARD"));
  return prepareSabrResponseDownload({
    sourceUrl,
    sandbox,
    onStage,
    youtube,
    rawPlayerResponse,
    capturedClientInfo: storedPlayerResponse.clientInfo,
  });
}

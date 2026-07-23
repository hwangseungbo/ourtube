import { Innertube, Platform } from "youtubei.js";
import { buildSabrFormat } from "googlevideo/utils";
import { getOnesieConfig, getOnesiePlayerResponse } from "../extension/src/onesie.js";

const videoId = process.argv[2] || "jNQXAC9IVRw";
Platform.shim.eval = async (data) => new Function(data.output)();

console.error("[1/3] YouTube session and Onesie config");
const [youtube, clientConfig] = await Promise.all([
  Innertube.create({ lang: "ko", location: "KR", enable_session_cache: false }),
  getOnesieConfig(),
]);
console.error("[2/3] Onesie player request");
const response = await getOnesiePlayerResponse({
  clientConfig,
  context: youtube.session.context,
  player: youtube.session.player,
  videoId,
});
console.error("[3/3] Parsing formats");
const formats = (response.streamingData?.adaptiveFormats || []).map(buildSabrFormat);
const video = formats
  .filter((format) => /video\/mp4/.test(format.mimeType || "") && /avc1/.test(format.mimeType || ""))
  .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
const audio = formats
  .filter((format) => /audio\/mp4/.test(format.mimeType || "") && /mp4a/.test(format.mimeType || ""))
  .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

console.log(JSON.stringify({
  title: response.videoDetails?.title,
  playability: response.playabilityStatus?.status,
  hasServerAbrUrl: Boolean(response.streamingData?.serverAbrStreamingUrl),
  hasUstreamerConfig: Boolean(response.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig),
  formatCount: formats.length,
  video: video && { itag: video.itag, height: video.height, mimeType: video.mimeType },
  audio: audio && { itag: audio.itag, bitrate: audio.bitrate, mimeType: audio.mimeType },
}, null, 2));

if (!response.streamingData?.serverAbrStreamingUrl || !video || !audio) process.exitCode = 2;

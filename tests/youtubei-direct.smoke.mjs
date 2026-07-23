import { ClientType, Innertube, Platform } from "youtubei.js";

const videoId = process.argv[2] || "jNQXAC9IVRw";

Platform.shim.eval = async (data) => new Function(data.output)();

const clientType = process.argv[3] || "WEB";
const resolvedClientType = ClientType[clientType] || clientType;

const youtube = await Innertube.create({
  lang: "ko",
  location: "KR",
  generate_session_locally: true,
  enable_session_cache: false,
  client_type: resolvedClientType,
});

const info = await youtube.getBasicInfo(videoId);
const allFormats = [
  ...(info.streaming_data?.formats || []),
  ...(info.streaming_data?.adaptive_formats || []),
];
const downloadableFormats = allFormats.filter((format) => (
  format.url || format.signature_cipher || format.cipher
));

if (downloadableFormats.length === 0) {
  console.log(JSON.stringify({
    id: info.basic_info.id,
    title: info.basic_info.title,
    clientType,
    playability: info.playability_status,
    formats: allFormats.map((format) => ({
      itag: format.itag,
      mimeType: format.mime_type,
      width: format.width,
      height: format.height,
      hasUrl: Boolean(format.url),
      hasSignatureCipher: Boolean(format.signature_cipher || format.cipher),
    })),
  }, null, 2));
  process.exitCode = 2;
  process.exit();
}
const video = downloadableFormats
  .filter((format) => format.has_video && !format.has_audio && /video\/mp4/.test(format.mime_type) && /avc1/.test(format.mime_type))
  .sort((a, b) => (b.height || 0) - (a.height || 0) || b.bitrate - a.bitrate)[0];
const audio = downloadableFormats
  .filter((format) => format.has_audio && !format.has_video && /audio\/mp4/.test(format.mime_type) && /mp4a/.test(format.mime_type))
  .sort((a, b) => b.bitrate - a.bitrate)[0];

if (!video || !audio) {
  console.log(JSON.stringify({
    id: info.basic_info.id,
    title: info.basic_info.title,
    clientType,
    downloadableFormats: downloadableFormats.map((format) => ({
      itag: format.itag,
      mimeType: format.mime_type,
      width: format.width,
      height: format.height,
      hasAudio: format.has_audio,
      hasVideo: format.has_video,
      hasUrl: Boolean(format.url),
      hasSignatureCipher: Boolean(format.signature_cipher || format.cipher),
    })),
  }, null, 2));
  process.exitCode = 3;
  process.exit();
}

const [videoUrl, audioUrl] = await Promise.all([
  video.decipher(youtube.session.player),
  audio.decipher(youtube.session.player),
]);

const summarize = (format, url) => ({
  itag: format.itag,
  mimeType: format.mime_type,
  width: format.width,
  height: format.height,
  fps: format.fps,
  contentLength: format.content_length,
  host: new URL(url).host,
  hasN: new URL(url).searchParams.has("n"),
});

console.log(JSON.stringify({
  id: info.basic_info.id,
  title: info.basic_info.title,
  duration: info.basic_info.duration,
  video: summarize(video, videoUrl),
  audio: summarize(audio, audioUrl),
}, null, 2));

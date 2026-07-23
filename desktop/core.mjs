const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const FORMAT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;

export function getYouTubeVideoId(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("올바른 YouTube 영상 주소를 입력해 주세요.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("YouTube HTTP 또는 HTTPS 주소만 사용할 수 있습니다.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") || "";
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1] || "";
    }
  }

  if (!YOUTUBE_ID_PATTERN.test(videoId)) {
    throw new Error("올바른 YouTube 영상 주소를 입력해 주세요.");
  }
  return videoId;
}

export function normalizeYouTubeUrl(rawUrl) {
  return `https://www.youtube.com/watch?v=${getYouTubeVideoId(rawUrl)}`;
}

export function sanitizeFilename(value) {
  const safe = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 150);
  return `${safe || "아워튜브 영상"}.mp4`;
}

function codecLabel(value = "") {
  if (/^avc1/i.test(value)) return "H.264";
  if (/^av01/i.test(value)) return "AV1";
  if (/^(vp09|vp9)/i.test(value)) return "VP9";
  return value && value !== "none" ? value : "영상";
}

function formatScore(format) {
  const extScore = format.ext === "mp4" ? 1_000_000_000 : 0;
  const codecScore = /^avc1/i.test(format.vcodec || "") ? 500_000_000 : 0;
  const protocolScore = /^https?$/i.test(format.protocol || "") ? 50_000_000 : 0;
  const bitrateScore = Number(format.tbr || format.vbr || 0) * 1_000;
  const fpsScore = Number(format.fps || 0);
  return extScore + codecScore + protocolScore + bitrateScore + fpsScore;
}

export function selectVideoFormats(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const candidates = formats.filter((format) => (
    format
    && format.format_id
    && FORMAT_ID_PATTERN.test(String(format.format_id))
    && Number(format.height) > 0
    && format.vcodec
    && format.vcodec !== "none"
    && !["mhtml", "images"].includes(String(format.protocol || ""))
  ));

  const byHeight = new Map();
  for (const format of candidates) {
    const height = Number(format.height);
    const current = byHeight.get(height);
    const hasAudio = Boolean(format.acodec && format.acodec !== "none");
    const currentHasAudio = Boolean(current?.acodec && current.acodec !== "none");
    const shouldReplace = (
      !current
      || (currentHasAudio && !hasAudio)
      || (currentHasAudio === hasAudio && formatScore(format) > formatScore(current))
    );
    if (shouldReplace) byHeight.set(height, format);
  }

  return [...byHeight.values()]
    .sort((left, right) => Number(right.height) - Number(left.height))
    .map((format) => {
      const approximateBytes = Number(format.filesize || format.filesize_approx) || null;
      const fps = Number(format.fps) || null;
      return {
        id: String(format.format_id),
        height: Number(format.height),
        label: `${Number(format.height)}p${fps && fps > 30 ? ` ${fps}fps` : ""}`,
        codec: codecLabel(format.vcodec),
        ext: String(format.ext || ""),
        fps,
        approximateBytes,
        hasAudio: Boolean(format.acodec && format.acodec !== "none"),
      };
    });
}

export function buildFormatSelector(format) {
  const id = String(format?.id || "");
  if (!FORMAT_ID_PATTERN.test(id)) throw new Error("선택한 영상 화질 정보가 올바르지 않습니다.");
  if (format.hasAudio) return id;
  return `${id}+bestaudio[ext=m4a]/bestaudio/${id}`;
}

function parseVersion(value) {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(value || "").trim());
  if (!match) throw new Error("앱 버전 형식이 올바르지 않습니다.");
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function parseProgressLine(line) {
  const prefix = "__OURTUBE_PROGRESS__:";
  if (!String(line).startsWith(prefix)) return null;
  const [rawPercent, rawDownloaded, rawTotal, rawSpeed, rawEta] = String(line)
    .slice(prefix.length)
    .split("|");
  const percent = Number.parseFloat(String(rawPercent || "").replace("%", "").trim());
  const downloadedBytes = Number(rawDownloaded) || 0;
  const totalBytes = Number(rawTotal) || 0;
  const speed = Number(rawSpeed) || 0;
  const eta = Number(rawEta);
  return {
    percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
    downloadedBytes,
    totalBytes,
    speed,
    eta: Number.isFinite(eta) ? Math.max(0, eta) : null,
  };
}

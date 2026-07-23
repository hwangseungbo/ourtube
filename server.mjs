import { randomUUID } from "node:crypto";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.WETUBE_PORT ?? "4545", 10);
const MAX_CONCURRENT_JOBS = 2;
const MAX_BODY_BYTES = 16 * 1024;
const JOB_TTL_MS = 60 * 60 * 1000;
const projectDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(projectDirectory, "public");
const downloadsDirectory = join(projectDirectory, "downloads");
const jobs = new Map();
let runningJobs = 0;

const commandEnvironment = {
  ...process.env,
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
};

await mkdir(downloadsDirectory, { recursive: true });

function sendJson(response, data, status = 200) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendText(response, text, status = 200, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function validateYouTubeUrl(rawValue) {
  if (typeof rawValue !== "string" || rawValue.length > 2_048) {
    throw new Error("유효한 YouTube 링크를 입력해 주세요.");
  }

  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new Error("링크 형식이 올바르지 않습니다.");
  }

  if (url.protocol !== "https:") {
    throw new Error("HTTPS YouTube 링크만 사용할 수 있습니다.");
  }

  const host = url.hostname.toLowerCase();
  const allowedHosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (!allowedHosts.has(host)) {
    throw new Error("현재 버전은 YouTube 링크만 지원합니다.");
  }

  if (host === "youtu.be") {
    if (!/^\/[A-Za-z0-9_-]{6,}$/.test(url.pathname)) {
      throw new Error("YouTube 영상 링크를 확인해 주세요.");
    }
  } else if (url.pathname === "/watch") {
    if (!/^[A-Za-z0-9_-]{6,}$/.test(url.searchParams.get("v") ?? "")) {
      throw new Error("YouTube 영상 링크를 확인해 주세요.");
    }
  } else if (!/^\/(shorts|live)\/[A-Za-z0-9_-]{6,}/.test(url.pathname)) {
    throw new Error("영상, Shorts 또는 라이브 링크를 입력해 주세요.");
  }

  return url;
}

function assertRightsConfirmed(value) {
  if (value !== true) {
    throw new Error("다운로드 권한이 있음을 먼저 확인해 주세요.");
  }
}

async function readBody(request) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("JSON 요청만 허용됩니다.");
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_BODY_BYTES) throw new Error("요청 데이터가 너무 큽니다.");
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON 요청 형식이 올바르지 않습니다.");
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: commandEnvironment,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const lastError = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1);
      reject(new Error(lastError || `${command} 실행 실패`));
    });
  });
}

async function getRawVideoInfo(url) {
  const output = await runCommand("yt-dlp", [
    "--encoding",
    "utf-8",
    "--no-js-runtimes",
    "--js-runtimes",
    "node",
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    url.href,
  ]);
  return JSON.parse(output);
}

async function getMetadata(url) {
  const raw = await getRawVideoInfo(url);
  const qualities = [...new Set(
    (Array.isArray(raw.formats) ? raw.formats : [])
      .filter((format) =>
        typeof format?.height === "number" && format.height > 0 &&
        typeof format?.vcodec === "string" && format.vcodec !== "none" &&
        format.has_drm !== true
      )
      .map((format) => Math.round(format.height)),
  )].sort((a, b) => b - a);

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? "제목 없음"),
    uploader: String(raw.uploader ?? raw.channel ?? "알 수 없음"),
    duration: typeof raw.duration === "number" ? raw.duration : null,
    thumbnail: typeof raw.thumbnail === "string" ? raw.thumbnail : null,
    webpage_url: typeof raw.webpage_url === "string" ? raw.webpage_url : url.href,
    qualities,
  };
}

function parseGoogleVideoUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (host !== "googlevideo.com" && !host.endsWith(".googlevideo.com")) return null;
    return url;
  } catch {
    return null;
  }
}

function numericValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pickProbeFormat(formats, kind) {
  const candidates = formats.filter((format) => {
    if (!format || format.has_drm === true || !parseGoogleVideoUrl(format.url)) return false;
    const hasVideo = typeof format.vcodec === "string" && format.vcodec !== "none";
    const hasAudio = typeof format.acodec === "string" && format.acodec !== "none";
    return kind === "video" ? hasVideo && !hasAudio : hasAudio && !hasVideo;
  });

  candidates.sort((a, b) => {
    const score = (format) => {
      if (kind === "video") {
        const mp4 = format.ext === "mp4" ? 1_000_000_000 : 0;
        const h264 = String(format.vcodec ?? "").startsWith("avc1") ? 100_000_000 : 0;
        return mp4 + h264 + numericValue(format.height) * 10_000 + numericValue(format.tbr);
      }

      const m4a = format.ext === "m4a" ? 1_000_000_000 : 0;
      const aac = String(format.acodec ?? "").startsWith("mp4a") ? 100_000_000 : 0;
      return m4a + aac + numericValue(format.abr);
    };
    return score(b) - score(a);
  });

  return candidates[0] ?? null;
}

function publicProbeFormat(format, kind) {
  return {
    kind,
    url: format.url,
    itag: String(format.format_id ?? ""),
    container: String(format.ext ?? ""),
    codec: String(kind === "video" ? format.vcodec ?? "" : format.acodec ?? ""),
    height: kind === "video" && typeof format.height === "number" ? format.height : null,
    approximateBytes:
      typeof format.filesize === "number"
        ? format.filesize
        : typeof format.filesize_approx === "number"
          ? format.filesize_approx
          : null,
  };
}

function getSignedUrlExpiry(streams) {
  const expiries = streams
    .map((stream) => parseGoogleVideoUrl(stream.url)?.searchParams.get("expire"))
    .map((value) => Number.parseInt(value ?? "", 10) * 1000)
    .filter((value) => Number.isFinite(value) && value > Date.now());

  return expiries.length > 0 ? Math.min(...expiries) : Date.now() + 5 * 60 * 1000;
}

async function getExtensionProbeTargets(url) {
  const raw = await getRawVideoInfo(url);
  const formats = Array.isArray(raw.formats) ? raw.formats : [];
  const video = pickProbeFormat(formats, "video");
  const audio = pickProbeFormat(formats, "audio");

  if (!video || !audio) {
    throw new Error("테스트할 비 DRM 영상·음성 스트림을 모두 찾지 못했습니다.");
  }

  const streams = [publicProbeFormat(video, "video"), publicProbeFormat(audio, "audio")];
  return {
    videoId: String(raw.id ?? ""),
    title: String(raw.title ?? "제목 없음"),
    expiresAt: getSignedUrlExpiry(streams),
    streams,
  };
}

function parseProgressLine(job, line) {
  if (!line.startsWith("PROGRESS|")) return;
  const [, percent = "0", speed = "", eta = ""] = line.split("|");
  const numericPercent = Number.parseFloat(percent.replace("%", "").trim());
  if (Number.isFinite(numericPercent)) {
    job.progress = Math.max(0, Math.min(100, numericPercent));
  }
  job.speed = speed.trim();
  job.eta = eta.trim();
}

function getVideoId(url) {
  if (url.hostname.toLowerCase() === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  if (url.pathname === "/watch") return url.searchParams.get("v") ?? "";
  return url.pathname.split("/").filter(Boolean)[1] ?? "";
}

function getQualityLabel(kind, quality) {
  if (kind === "audio") return null;
  return quality === "best" ? "best" : `max-${quality}p`;
}

function validateQuality(kind, value) {
  if (kind === "audio") return null;
  if (value === "best") return value;
  if (typeof value === "string" && /^\d{3,5}$/.test(value)) {
    const height = Number.parseInt(value, 10);
    if (height >= 100 && height <= 10_000) return String(height);
  }
  throw new Error("영상 화질을 선택해 주세요.");
}

async function findDownloadedFile(videoId, kind, quality) {
  const expectedExtension = kind === "audio" ? ".mp3" : ".mp4";
  const qualityLabel = getQualityLabel(kind, quality);
  const entries = await readdir(downloadsDirectory, { withFileTypes: true });
  const entry = entries.find((candidate) =>
    candidate.isFile() && candidate.name.includes(`[${videoId}]`) &&
    candidate.name.toLowerCase().endsWith(expectedExtension) &&
    (!qualityLabel || candidate.name.includes(`[${qualityLabel}]`))
  );

  return entry
    ? { name: entry.name, path: join(downloadsDirectory, entry.name) }
    : null;
}

async function openDownloadsFolder() {
  if (process.platform !== "win32") {
    throw new Error(`다운로드 폴더: ${downloadsDirectory}`);
  }

  const child = spawn("explorer.exe", [downloadsDirectory], {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}

function consumeLines(stream, onLine) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) onLine(line.trim());
    });
    stream.once("end", () => {
      if (buffer.trim()) onLine(buffer.trim());
      resolve();
    });
    stream.once("error", reject);
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

async function runDownload(job, url, kind, videoId, quality) {
  runningJobs += 1;
  job.status = "running";
  const errors = [];
  const qualityLabel = getQualityLabel(kind, quality);
  const outputTemplate = kind === "audio"
    ? "%(title)s [%(id)s].%(ext)s"
    : `%(title)s [%(id)s] [${qualityLabel}].%(ext)s`;

  const commonArgs = [
    "--encoding",
    "utf-8",
    "--no-js-runtimes",
    "--js-runtimes",
    "node",
    "--newline",
    "--no-playlist",
    "--windows-filenames",
    "--trim-filenames",
    "180",
    "--progress-template",
    "download:PROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
    "--paths",
    downloadsDirectory,
    "--output",
    outputTemplate,
  ];
  const videoFormat = quality === "best"
    ? "bestvideo*+bestaudio/best"
    : `bestvideo*[height<=${quality}]+bestaudio/best[height<=${quality}]`;
  const formatArgs = kind === "audio"
    ? [
      "--format",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
    ]
    : ["--format", videoFormat, "--merge-output-format", "mp4"];

  try {
    const child = spawn("yt-dlp", [...commonArgs, ...formatArgs, url.href], {
      env: commandEnvironment,
      shell: false,
      windowsHide: true,
    });
    const exitPromise = waitForExit(child);
    const [, , exitCode] = await Promise.all([
      consumeLines(child.stdout, (line) => parseProgressLine(job, line)),
      consumeLines(child.stderr, (line) => {
        if (line) errors.push(line);
      }),
      exitPromise,
    ]);
    if (exitCode !== 0) {
      throw new Error(errors.at(-1) ?? "다운로드에 실패했습니다.");
    }

    const downloadedFile = await findDownloadedFile(videoId, kind, quality);
    if (!downloadedFile) {
      throw new Error("다운로드 명령은 끝났지만 저장된 파일을 찾지 못했습니다.");
    }

    job.progress = 100;
    job.outputPath = downloadedFile.path;
    job.outputName = downloadedFile.name;
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "다운로드에 실패했습니다.";
  } finally {
    runningJobs -= 1;
  }
}

async function checkDependency(command, args) {
  try {
    await runCommand(command, args);
    return true;
  } catch {
    return false;
  }
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/legal.css", ["legal.css", "text/css; charset=utf-8"]],
  ["/privacy", ["privacy.html", "text/html; charset=utf-8"]],
  ["/privacy.html", ["privacy.html", "text/html; charset=utf-8"]],
  ["/terms", ["terms.html", "text/html; charset=utf-8"]],
  ["/terms.html", ["terms.html", "text/html; charset=utf-8"]],
  ["/support", ["support.html", "text/html; charset=utf-8"]],
  ["/support.html", ["support.html", "text/html; charset=utf-8"]],
  ["/desktop", ["desktop.html", "text/html; charset=utf-8"]],
  ["/desktop.html", ["desktop.html", "text/html; charset=utf-8"]],
  ["/open-source", ["open-source.html", "text/html; charset=utf-8"]],
  ["/open-source.html", ["open-source.html", "text/html; charset=utf-8"]],
  ["/code-signing", ["code-signing.html", "text/html; charset=utf-8"]],
  ["/code-signing.html", ["code-signing.html", "text/html; charset=utf-8"]],
  ["/app-version.json", ["app-version.json", "application/json; charset=utf-8"]],
  ["/favicon.ico", ["favicon.ico", "image/x-icon"]],
  ["/og.png", ["og.png", "image/png"]],
  ["/icons/favicon-32.png", ["icons/favicon-32.png", "image/png"]],
  ["/icons/favicon-512.png", ["icons/favicon-512.png", "image/png"]],
  ["/icons/apple-touch-icon.png", ["icons/apple-touch-icon.png", "image/png"]],
  ["/icons/logo.png", ["icons/logo.png", "image/png"]],
  ["/botguard-runtime.html", ["botguard-runtime.html", "text/html; charset=utf-8"]],
  ["/botguard-runtime.js", ["botguard-runtime.js", "text/javascript; charset=utf-8"]],
]);

async function serveStatic(pathname, response) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    sendText(response, "Not found", 404);
    return;
  }

  try {
    const body = await readFile(join(publicDirectory, entry[0]));
    const isBotguardRuntime = pathname.startsWith("/botguard-runtime.");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": body.length,
      "content-security-policy": isBotguardRuntime
        ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self'; connect-src 'none'"
        : "default-src 'self'; img-src 'self' https:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
      "content-type": entry[1],
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch {
    sendText(response, "정적 파일을 읽지 못했습니다.", 500);
  }
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== "running") jobs.delete(id);
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  cleanupJobs();

  try {
    if (
      (request.method === "GET" || request.method === "HEAD")
      && url.pathname === "/download/windows"
    ) {
      const versionPayload = JSON.parse(
        await readFile(join(publicDirectory, "app-version.json"), "utf8"),
      );
      const version = /^\d+\.\d+\.\d+$/.test(versionPayload?.version)
        ? versionPayload.version
        : "0.2.6";
      response.writeHead(302, {
        "cache-control": "no-store",
        location: `https://github.com/hwangseungbo/ourtube-releases/releases/download/v${version}/OurTube-Setup-${version}.exe`,
        "x-robots-tag": "noindex, nofollow",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      const [ytDlp, ffmpeg] = await Promise.all([
        checkDependency("yt-dlp", ["--version"]),
        checkDependency("ffmpeg", ["-version"]),
      ]);
      sendJson(response, { ok: ytDlp && ffmpeg, dependencies: { ytDlp, ffmpeg } });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/metadata") {
      const body = await readBody(request);
      assertRightsConfirmed(body.rightsConfirmed);
      const videoUrl = validateYouTubeUrl(body.url);
      sendJson(response, { video: await getMetadata(videoUrl) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/extension/probe-targets") {
      const body = await readBody(request);
      assertRightsConfirmed(body.rightsConfirmed);
      const videoUrl = validateYouTubeUrl(body.url);
      sendJson(response, { probe: await getExtensionProbeTargets(videoUrl) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/extension/download-targets") {
      const body = await readBody(request);
      assertRightsConfirmed(body.rightsConfirmed);
      const videoUrl = validateYouTubeUrl(body.url);
      sendJson(response, { download: await getExtensionProbeTargets(videoUrl) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/download") {
      if (runningJobs >= MAX_CONCURRENT_JOBS) {
        sendJson(response, { error: "동시에 최대 2개까지 다운로드할 수 있습니다." }, 429);
        return;
      }

      const body = await readBody(request);
      assertRightsConfirmed(body.rightsConfirmed);
      const videoUrl = validateYouTubeUrl(body.url);
      const videoId = getVideoId(videoUrl);
      const kind = body.kind === "audio" ? "audio" : body.kind === "video" ? "video" : null;
      if (!kind) throw new Error("저장 형식을 선택해 주세요.");
      const quality = validateQuality(kind, body.quality);

      const job = {
        id: randomUUID(),
        status: "queued",
        title: typeof body.title === "string" ? body.title.slice(0, 300) : "다운로드",
        progress: 0,
        speed: "",
        eta: "",
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      void runDownload(job, videoUrl, kind, videoId, quality);
      sendJson(response, { jobId: job.id }, 202);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/downloads/open") {
      await readBody(request);
      await openDownloadsFolder();
      sendJson(response, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = jobs.get(id);
      sendJson(response, job ? { job } : { error: "작업을 찾을 수 없습니다." }, job ? 200 : 404);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }
    sendJson(response, { error: "지원하지 않는 요청입니다." }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : "요청 처리에 실패했습니다.";
    sendJson(response, { error: message }, 400);
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`${PORT} 포트를 이미 사용 중입니다. 기존 아워튜브 서버를 먼저 종료해 주세요.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`아워튜브가 http://${HOST}:${PORT} 에서 실행 중입니다.`);
});

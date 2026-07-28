import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import electronUpdater from "electron-updater";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFormatSelector,
  compareVersions,
  createDownloadProgressTracker,
  normalizeYouTubeUrl,
  parseProgressLine,
  sanitizeFilename,
  selectVideoFormats,
} from "./core.mjs";

const { autoUpdater } = electronUpdater;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const rendererPath = path.join(__dirname, "index.html");
const updateMetadataUrl = "https://ourtube.kr/app-version.json";
const updateDownloadPageUrl = "https://ourtube.kr/desktop";
const updateReleaseBaseUrl = "https://github.com/hwangseungbo/ourtube-releases/releases/download";
const maxUpdateMetadataBytes = 16 * 1024;
const allowedExternalUrls = new Set([
  "https://ourtube.kr/",
  updateDownloadPageUrl,
  "https://ourtube.kr/privacy",
  "https://ourtube.kr/terms",
  "https://ourtube.kr/open-source",
  "https://ourtube.kr/code-signing",
  "https://ourtube.kr/support",
]);
const inspections = new Map();

let mainWindow = null;
let activeJob = null;
let lastCompletedPath = "";
let pendingProtocolUrl = "";
let activeUpdateCheck = null;
let activeUpdateDownload = null;
let downloadedUpdateVersion = "";
let autoUpdaterConfigured = false;

function getToolPaths() {
  if (app.isPackaged) {
    return {
      ytDlp: path.join(process.resourcesPath, "bin", "yt-dlp.exe"),
      ffmpeg: path.join(process.resourcesPath, "bin", "ffmpeg.exe"),
    };
  }
  return {
    ytDlp: path.join(projectRoot, "desktop", "bin", "yt-dlp.exe"),
    ffmpeg: path.join(projectRoot, "node_modules", "ffmpeg-static", "ffmpeg.exe"),
  };
}

async function isFileReadable(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("허용되지 않은 앱 요청입니다.");
  }
}

async function fetchUpdateMetadata() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(updateMetadataUrl, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`버전 서버 응답 오류 (${response.status})`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > maxUpdateMetadataBytes) throw new Error("버전 정보가 허용 크기를 초과했습니다.");

    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxUpdateMetadataBytes) {
      throw new Error("버전 정보가 허용 크기를 초과했습니다.");
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("버전 정보 형식이 올바르지 않습니다.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("버전 정보 형식이 올바르지 않습니다.");
    }

    const version = String(data.version || "").trim();
    compareVersions(version, version);
    if (String(data.downloadPage || "") !== updateDownloadPageUrl) {
      throw new Error("공식 다운로드 주소가 일치하지 않습니다.");
    }
    const sha256 = String(data.sha256 || "").trim().toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(sha256)) throw new Error("설치 파일 체크섬이 올바르지 않습니다.");

    const releaseNotes = Array.isArray(data.releaseNotes)
      ? data.releaseNotes
        .filter((note) => typeof note === "string" && note.trim())
        .slice(0, 6)
        .map((note) => note.trim().slice(0, 240))
      : [];

    return {
      version,
      downloadPage: updateDownloadPageUrl,
      sha256,
      releaseNotes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sendUpdateStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:update-status", payload);
}

function configureAutoUpdater() {
  if (!app.isPackaged) throw new Error("설치된 앱에서만 인앱 업데이트를 사용할 수 있습니다.");
  if (autoUpdaterConfigured) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.previousBlockmapBaseUrlOverride =
    `${updateReleaseBaseUrl}/v${app.getVersion()}`;

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      state: "downloading",
      percent: Number(progress.percent) || 0,
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
      bytesPerSecond: Number(progress.bytesPerSecond) || 0,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    downloadedUpdateVersion = String(info.version || "");
    sendUpdateStatus({
      state: "downloaded",
      version: downloadedUpdateVersion,
    });
  });
  autoUpdater.on("error", (error) => {
    sendUpdateStatus({
      state: "error",
      message: error?.message || "업데이트 다운로드 실패",
    });
  });

  autoUpdaterConfigured = true;
}

async function offerDownloadedUpdate(version) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "아워튜브 업데이트",
    message: `업데이트 ${version} 다운로드가 완료되었습니다.`,
    detail: "지금 앱을 재시작하면 업데이트를 설치하고 아워튜브를 다시 실행합니다.",
    buttons: ["지금 재시작하여 업데이트", "나중에"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  if (result.response !== 0) {
    return { status: "downloaded", version, installing: false };
  }

  sendUpdateStatus({ state: "installing", version });
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 150);
  return { status: "installing", version, installing: true };
}

async function downloadAppUpdate(metadata) {
  if (downloadedUpdateVersion === metadata.version) {
    return offerDownloadedUpdate(metadata.version);
  }
  if (activeUpdateDownload) return activeUpdateDownload;

  activeUpdateDownload = (async () => {
    try {
      configureAutoUpdater();
      sendUpdateStatus({ state: "checking", version: metadata.version });

      const result = await autoUpdater.checkForUpdates();
      const availableVersion = String(result?.updateInfo?.version || "");
      if (availableVersion !== metadata.version) {
        throw new Error("업데이트 서버의 버전 정보가 서로 일치하지 않습니다.");
      }

      sendUpdateStatus({ state: "starting", version: metadata.version });
      await autoUpdater.downloadUpdate();
      downloadedUpdateVersion = metadata.version;
      return offerDownloadedUpdate(metadata.version);
    } catch (error) {
      sendUpdateStatus({
        state: "error",
        message: error?.message || "업데이트 다운로드 실패",
      });
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "아워튜브 업데이트",
        message: "업데이트를 내려받지 못했습니다.",
        detail: "인터넷 연결을 확인한 뒤 앱의 버전 버튼에서 다시 시도해 주세요.",
        buttons: ["확인"],
      });
      return { status: "error", message: error?.message || "업데이트 다운로드 실패" };
    } finally {
      activeUpdateDownload = null;
    }
  })();

  return activeUpdateDownload;
}

async function performUpdateCheck(interactive) {
  try {
    const metadata = await fetchUpdateMetadata();
    const currentVersion = app.getVersion();
    if (compareVersions(metadata.version, currentVersion) <= 0) {
      if (interactive) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "아워튜브 업데이트",
          message: "현재 최신 버전을 사용하고 있습니다.",
          detail: `설치된 버전: ${currentVersion}`,
          buttons: ["확인"],
        });
      }
      return { status: "up-to-date", currentVersion };
    }

    const notes = metadata.releaseNotes.length
      ? `\n\n주요 변경 사항\n${metadata.releaseNotes.map((note) => `• ${note}`).join("\n")}`
      : "";
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "아워튜브 업데이트",
      message: `새 버전 ${metadata.version}을 사용할 수 있습니다.`,
      detail: `현재 버전 ${currentVersion}${notes}\n\n업데이트를 앱 안에서 내려받을까요? 필요한 변경 부분만 우선 다운로드합니다.`,
      buttons: ["업데이트 다운로드", "나중에"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result.response === 0) {
      return downloadAppUpdate(metadata);
    }
    return { status: "available", version: metadata.version, accepted: false };
  } catch (error) {
    if (interactive) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "아워튜브 업데이트",
        message: "업데이트 정보를 확인하지 못했습니다.",
        detail: "인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        buttons: ["확인"],
      });
    }
    return { status: "error", message: error?.message || "업데이트 확인 실패" };
  }
}

function checkForAppUpdate(interactive = false) {
  if (activeUpdateCheck) return activeUpdateCheck;
  activeUpdateCheck = performUpdateCheck(Boolean(interactive))
    .finally(() => {
      activeUpdateCheck = null;
    });
  return activeUpdateCheck;
}

function splitLines(onLine) {
  let remainder = "";
  return {
    write(chunk) {
      remainder += chunk.toString("utf8");
      const lines = remainder.split(/\r?\n/);
      remainder = lines.pop() || "";
      for (const line of lines) onLine(line);
    },
    end() {
      if (remainder) onLine(remainder);
      remainder = "";
    },
  };
}

function runProcess(executable, args, {
  onStdoutLine = () => {},
  onStderrLine = () => {},
  collectStdout = false,
  jobId = "",
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8" },
    });
    if (jobId) activeJob = { id: jobId, child, canceled: false };

    let stdout = "";
    let stderr = "";
    const stdoutLines = splitLines((line) => {
      if (collectStdout) {
        stdout += `${line}\n`;
        if (stdout.length > 64 * 1024 * 1024) {
          child.kill();
          reject(new Error("영상 정보 응답이 너무 큽니다."));
          return;
        }
      }
      onStdoutLine(line);
    });
    const stderrLines = splitLines((line) => {
      stderr += `${line}\n`;
      if (stderr.length > 2 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024);
      onStderrLine(line);
    });

    child.stdout.on("data", (chunk) => stdoutLines.write(chunk));
    child.stderr.on("data", (chunk) => stderrLines.write(chunk));
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      stdoutLines.end();
      stderrLines.end();
      const canceled = Boolean(jobId && activeJob?.id === jobId && activeJob.canceled);
      if (jobId && activeJob?.id === jobId) activeJob = null;
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }
      if (canceled) {
        const cancelError = new Error("다운로드를 취소했습니다.");
        cancelError.name = "AbortError";
        reject(cancelError);
        return;
      }
      const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-4).join("\n");
      reject(new Error(detail || `로컬 다운로드 엔진이 종료되었습니다. (코드 ${code})`));
    });
  });
}

function emitProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:progress", payload);
  }
}

async function copyFileWithProgress(sourcePath, destinationPath, onProgress) {
  const details = await stat(sourcePath);
  const totalBytes = Math.max(0, Number(details.size) || 0);
  let copiedBytes = 0;
  let lastEmittedAt = 0;
  const source = createReadStream(sourcePath);
  const destination = createWriteStream(destinationPath);

  source.on("data", (chunk) => {
    copiedBytes += chunk.length;
    const now = Date.now();
    if (copiedBytes < totalBytes && now - lastEmittedAt < 100) return;
    lastEmittedAt = now;
    onProgress({
      copiedBytes,
      totalBytes,
      fraction: totalBytes > 0 ? Math.min(1, copiedBytes / totalBytes) : 1,
    });
  });

  await pipeline(source, destination);
}

async function inspectVideo(sourceUrl) {
  if (activeJob) throw new Error("다른 작업이 진행 중입니다.");
  const normalizedUrl = normalizeYouTubeUrl(sourceUrl);
  const tools = getToolPaths();
  if (!await isFileReadable(tools.ytDlp)) {
    throw new Error("로컬 영상 분석 엔진을 찾지 못했습니다.");
  }

  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--skip-download",
    "--no-warnings",
    "--encoding", "utf-8",
    normalizedUrl,
  ];
  const { stdout } = await runProcess(tools.ytDlp, args, { collectStdout: true });
  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new Error("영상 정보 응답을 읽지 못했습니다.");
  }

  const qualityOptions = selectVideoFormats(info);
  if (qualityOptions.length === 0) {
    throw new Error("저장 가능한 영상 화질을 찾지 못했습니다.");
  }
  const analysisId = randomUUID();
  const formatMap = new Map(qualityOptions.map((format) => [format.id, format]));
  inspections.set(analysisId, {
    sourceUrl: normalizedUrl,
    title: String(info.title || "YouTube 영상"),
    formatMap,
    createdAt: Date.now(),
  });
  for (const [key, value] of inspections) {
    if (Date.now() - value.createdAt > 30 * 60 * 1000) inspections.delete(key);
  }

  return {
    analysisId,
    title: String(info.title || "YouTube 영상"),
    uploader: String(info.uploader || info.channel || ""),
    thumbnail: String(info.thumbnail || ""),
    duration: Number(info.duration) || null,
    qualityOptions,
    selectedQualityId: qualityOptions[0].id,
  };
}

async function findCompletedFile(directory, reportedPath) {
  if (reportedPath && await isFileReadable(reportedPath)) return reportedPath;
  const names = await readdir(directory);
  const candidates = [];
  for (const name of names) {
    if (/\.(part|ytdl|temp)$/i.test(name)) continue;
    const filePath = path.join(directory, name);
    const details = await stat(filePath);
    if (details.isFile()) candidates.push({ filePath, size: details.size });
  }
  candidates.sort((left, right) => right.size - left.size);
  return candidates[0]?.filePath || "";
}

async function startDownload(event, { analysisId, qualityId }) {
  assertTrustedSender(event);
  if (activeJob) throw new Error("다른 작업이 진행 중입니다.");
  const inspection = inspections.get(String(analysisId || ""));
  if (!inspection) throw new Error("영상 정보가 만료됐습니다. 다시 확인해 주세요.");
  const format = inspection.formatMap.get(String(qualityId || ""));
  if (!format) throw new Error("선택한 영상 화질을 찾지 못했습니다.");

  const destination = await dialog.showSaveDialog(mainWindow, {
    title: "MP4 저장 위치 선택",
    defaultPath: path.join(app.getPath("downloads"), sanitizeFilename(inspection.title)),
    filters: [{ name: "MP4 동영상", extensions: ["mp4"] }],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  if (destination.canceled || !destination.filePath) return { canceled: true };

  const tools = getToolPaths();
  if (!await isFileReadable(tools.ytDlp) || !await isFileReadable(tools.ffmpeg)) {
    throw new Error("로컬 다운로드 또는 MP4 결합 엔진을 찾지 못했습니다.");
  }

  const jobId = randomUUID();
  const temporaryRoot = path.join(os.tmpdir(), "ourtube-desktop");
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(temporaryRoot, "job-"));
  const outputTemplate = path.join(temporaryDirectory, "output.%(ext)s");
  const formatSelector = buildFormatSelector(format);
  const trackDownloadProgress = createDownloadProgressTracker({
    separateAudio: !format.hasAudio,
  });
  let reportedPath = "";

  emitProgress({
    jobId,
    state: "starting",
    message: "사용자 PC에서 다운로드를 준비하는 중입니다…",
    percent: 0,
  });

  const args = [
    "--no-playlist",
    "--newline",
    "--progress-delta", "0.25",
    "--windows-filenames",
    "--encoding", "utf-8",
    "--ffmpeg-location", tools.ffmpeg,
    "--format", formatSelector,
    "--merge-output-format", "mp4",
    "--output", outputTemplate,
    "--progress-template",
    "download:__OURTUBE_PROGRESS__:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
    "--print", "after_move:__OURTUBE_FILE__:%(filepath)s",
    inspection.sourceUrl,
  ];

  try {
    const handleProgressLine = (line) => {
      const rawProgress = parseProgressLine(line);
      if (!rawProgress) return false;
      const progress = trackDownloadProgress(rawProgress);
      const partLabel = progress.downloadPart === "audio"
        ? "음성"
        : progress.downloadPart === "video"
          ? "영상"
          : "영상";
      emitProgress({
        jobId,
        state: "downloading",
        message: `${partLabel} 데이터를 이 PC로 내려받고 있습니다…`,
        ...progress,
      });
      return true;
    };

    await runProcess(tools.ytDlp, args, {
      jobId,
      onStdoutLine(line) {
        if (handleProgressLine(line)) return;
        if (line.startsWith("__OURTUBE_FILE__:")) {
          reportedPath = line.slice("__OURTUBE_FILE__:".length).trim();
        }
      },
      onStderrLine(line) {
        if (handleProgressLine(line)) return;
        if (/\[(Merger|VideoRemuxer)\]/.test(line)) {
          emitProgress({
            jobId,
            state: "merging",
            message: "이 PC에서 영상과 음성을 MP4로 결합하는 중입니다…",
            percent: 96,
          });
        }
      },
    });

    const completedFile = await findCompletedFile(temporaryDirectory, reportedPath);
    if (!completedFile) throw new Error("완성된 MP4 파일을 찾지 못했습니다.");
    emitProgress({
      jobId,
      state: "saving",
      message: "선택한 위치에 MP4를 저장하는 중입니다…",
      percent: 98,
    });
    await copyFileWithProgress(completedFile, destination.filePath, ({
      copiedBytes,
      totalBytes,
      fraction,
    }) => {
      emitProgress({
        jobId,
        state: "saving",
        message: "선택한 위치에 MP4를 저장하는 중입니다…",
        percent: 98 + (fraction * 1.9),
        downloadedBytes: copiedBytes,
        totalBytes,
        speed: 0,
        eta: null,
      });
    });
    lastCompletedPath = destination.filePath;
    inspections.delete(String(analysisId));
    emitProgress({
      jobId,
      state: "completed",
      message: "다운로드와 MP4 결합이 완료됐습니다.",
      percent: 100,
      filePath: destination.filePath,
    });
    return {
      canceled: false,
      filePath: destination.filePath,
      filename: path.basename(destination.filePath),
    };
  } catch (error) {
    const canceled = error?.name === "AbortError";
    emitProgress({
      jobId,
      state: canceled ? "canceled" : "failed",
      message: canceled ? "다운로드를 취소했습니다." : error.message,
    });
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function cancelActiveJob(event) {
  assertTrustedSender(event);
  if (!activeJob?.child || activeJob.child.killed) return { canceled: false };
  activeJob.canceled = true;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(activeJob.child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    activeJob.child.kill("SIGTERM");
  }
  return { canceled: true };
}

function extractProtocolUrl(argv) {
  const candidate = argv.find((value) => /^ourtube:\/\//i.test(value));
  if (!candidate) return "";
  try {
    const protocolUrl = new URL(candidate);
    const sourceUrl = protocolUrl.searchParams.get("url") || "";
    return normalizeYouTubeUrl(sourceUrl);
  } catch {
    return "";
  }
}

function deliverProtocolUrl() {
  if (!pendingProtocolUrl || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:open-url", { url: pendingProtocolUrl });
  pendingProtocolUrl = "";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 720,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: true,
    backgroundColor: "#0a0c0d",
    icon: path.join(projectRoot, "public", "favicon.ico"),
    title: "아워튜브",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternalUrls.has(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.once("did-finish-load", deliverProtocolUrl);
  void mainWindow.loadFile(rendererPath);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const sourceUrl = extractProtocolUrl(argv);
    if (sourceUrl) {
      pendingProtocolUrl = sourceUrl;
      deliverProtocolUrl();
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("kr.ourtube.desktop");
    if (app.isPackaged) app.setAsDefaultProtocolClient("ourtube");
    pendingProtocolUrl = extractProtocolUrl(process.argv);

    ipcMain.handle("desktop:get-status", async (event) => {
      assertTrustedSender(event);
      const tools = getToolPaths();
      return {
        ready: await isFileReadable(tools.ytDlp) && await isFileReadable(tools.ffmpeg),
        platform: process.platform,
        version: app.getVersion(),
      };
    });
    ipcMain.handle("desktop:inspect", async (event, payload) => {
      assertTrustedSender(event);
      return inspectVideo(payload?.url);
    });
    ipcMain.handle("desktop:download", startDownload);
    ipcMain.handle("desktop:cancel", cancelActiveJob);
    ipcMain.handle("desktop:check-update", async (event, payload) => {
      assertTrustedSender(event);
      return checkForAppUpdate(payload?.interactive === true);
    });
    ipcMain.handle("desktop:open-folder", async (event) => {
      assertTrustedSender(event);
      if (!lastCompletedPath) return { opened: false };
      shell.showItemInFolder(lastCompletedPath);
      return { opened: true };
    });

    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

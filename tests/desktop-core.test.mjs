import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFormatSelector,
  compareVersions,
  getYouTubeVideoId,
  normalizeYouTubeUrl,
  parseProgressLine,
  sanitizeFilename,
  selectVideoFormats,
} from "../desktop/core.mjs";

test("일반·단축·Shorts YouTube 주소에서 영상 ID를 읽는다", () => {
  assert.equal(getYouTubeVideoId("https://www.youtube.com/watch?v=VZJE5drHLdQ"), "VZJE5drHLdQ");
  assert.equal(getYouTubeVideoId("https://youtu.be/VZJE5drHLdQ?t=1"), "VZJE5drHLdQ");
  assert.equal(getYouTubeVideoId("https://youtube.com/shorts/VZJE5drHLdQ"), "VZJE5drHLdQ");
  assert.equal(normalizeYouTubeUrl("https://youtu.be/VZJE5drHLdQ"), "https://www.youtube.com/watch?v=VZJE5drHLdQ");
});

test("YouTube가 아닌 주소를 거부한다", () => {
  assert.throws(() => getYouTubeVideoId("https://example.com/watch?v=VZJE5drHLdQ"), /올바른 YouTube/);
});

test("Windows 파일명으로 사용할 수 없는 문자를 정리한다", () => {
  assert.equal(sanitizeFilename('  제프리: "테스트"  '), "제프리 테스트.mp4");
  assert.equal(sanitizeFilename(""), "아워튜브 영상.mp4");
});

test("같은 화질에서는 MP4 H.264 형식을 우선한다", () => {
  const selected = selectVideoFormats({
    formats: [
      { format_id: "248", height: 1080, ext: "webm", vcodec: "vp9", acodec: "none", tbr: 1600, protocol: "https" },
      { format_id: "137", height: 1080, ext: "mp4", vcodec: "avc1.640028", acodec: "none", tbr: 1200, protocol: "https", filesize: 1000 },
      { format_id: "18", height: 360, ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", tbr: 300, protocol: "https" },
    ],
  });
  assert.deepEqual(selected.map((format) => format.id), ["137", "18"]);
  assert.equal(selected[0].codec, "H.264");
  assert.equal(selected[1].hasAudio, true);
});

test("같은 화질에 영상 전용 형식이 있으면 최고 품질 음성을 별도로 결합한다", () => {
  const selected = selectVideoFormats({
    formats: [
      { format_id: "18", height: 360, ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", tbr: 420, protocol: "https" },
      { format_id: "134", height: 360, ext: "mp4", vcodec: "avc1.4d401e", acodec: "none", tbr: 180, protocol: "https" },
    ],
  });
  assert.equal(selected[0].id, "134");
  assert.equal(selected[0].hasAudio, false);
  assert.equal(buildFormatSelector(selected[0]), "134+bestaudio[ext=m4a]/bestaudio/134");
});

test("영상 전용 형식에는 가장 좋은 M4A 음성을 결합한다", () => {
  assert.equal(buildFormatSelector({ id: "137", hasAudio: false }), "137+bestaudio[ext=m4a]/bestaudio/137");
  assert.equal(buildFormatSelector({ id: "18", hasAudio: true }), "18");
});

test("앱 버전을 세 자리 숫자로 안전하게 비교한다", () => {
  assert.equal(compareVersions("0.2.2", "0.2.1"), 1);
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.2.1", "0.2.1"), 0);
  assert.equal(compareVersions("0.2.0", "0.2.1"), -1);
  assert.throws(() => compareVersions("latest", "0.2.1"), /버전 형식/);
});

test("yt-dlp 진행률 메시지를 앱 진행률로 변환한다", () => {
  assert.deepEqual(
    parseProgressLine("__OURTUBE_PROGRESS__:42.5%|1000|2000|500|2"),
    { percent: 42.5, downloadedBytes: 1000, totalBytes: 2000, speed: 500, eta: 2 },
  );
  assert.equal(parseProgressLine("[download] 42%"), null);
});

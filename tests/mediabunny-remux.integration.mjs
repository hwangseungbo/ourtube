import {
  FilePathSource,
  FilePathTarget,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import { remuxSeparateInputs } from "../extension/src/remux.js";

const [videoPath, audioPath, outputPath] = process.argv.slice(2);
if (!videoPath || !audioPath || !outputPath) {
  throw new Error("사용법: node tests/mediabunny-remux.integration.mjs <video.mp4> <audio.m4a> <output.mp4>");
}

const videoInput = new Input({ source: new FilePathSource(videoPath), formats: [MP4] });
const audioInput = new Input({ source: new FilePathSource(audioPath), formats: [MP4] });
const output = new Output({
  format: new Mp4OutputFormat({ fastStart: false }),
  target: new FilePathTarget(outputPath, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
});

let lastReported = -1;
await remuxSeparateInputs({
  videoInput,
  audioInput,
  output,
  onProgress(progress) {
    const percent = Math.floor(progress * 100);
    if (percent >= lastReported + 10) lastReported = percent;
  },
});

console.log(JSON.stringify({ ok: true, outputPath, progress: lastReported }));

import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builds = [
  ["extension/src/download-entry.js", "extension/download.js"],
  ["extension/src/offscreen-entry.js", "extension/offscreen.js"],
  ["extension/src/sandbox-entry.js", "extension/sandbox.js"],
  ["extension/src/sandbox-entry.js", "public/botguard-runtime.js"],
];

for (const [entryPoint, outfile] of builds) {
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [path.join(projectRoot, entryPoint)],
    format: "esm",
    legalComments: "eof",
    outfile: path.join(projectRoot, outfile),
    platform: "browser",
    target: "chrome116",
  });
}

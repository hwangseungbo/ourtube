import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, ".generated-licenses");
const packageLock = JSON.parse(
  await readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
);

const rootDocuments = [
  "LICENSE",
  "NOTICE",
  "TRADEMARKS.md",
  "THIRD_PARTY_NOTICES.md",
  "CODE_SIGNING_POLICY.md",
];

function safeName(packagePath) {
  return packagePath
    .replace(/^node_modules[\\/]/, "")
    .replaceAll("@", "")
    .replace(/[\\/]/g, "__");
}

async function copy(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const document of rootDocuments) {
  await copy(path.join(projectRoot, document), path.join(outputRoot, document));
}

const runtimePackages = Object.entries(packageLock.packages || {})
  .filter(([packagePath, metadata]) => packagePath && !metadata.dev && metadata.license);

const index = [];
for (const [packagePath, metadata] of runtimePackages) {
  const absolutePackagePath = path.join(projectRoot, packagePath);
  const files = await readdir(absolutePackagePath);
  const licenseFiles = files.filter((file) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(file),
  );
  const prefix = `${safeName(packagePath)}-${metadata.version}`;

  for (const file of licenseFiles) {
    await copy(
      path.join(absolutePackagePath, file),
      path.join(outputRoot, "npm", prefix, file),
    );
  }

  const packageInfo = [
    `Package: ${packagePath.replace(/^node_modules[\\/]/, "")}`,
    `Version: ${metadata.version}`,
    `License: ${metadata.license}`,
    licenseFiles.length
      ? `Included license files: ${licenseFiles.join(", ")}`
      : "Included license files: none in the published npm package; see package metadata and upstream repository.",
    "",
  ].join("\n");
  const packageInfoPath = path.join(outputRoot, "npm", prefix, "PACKAGE-INFO.txt");
  await mkdir(path.dirname(packageInfoPath), { recursive: true });
  await writeFile(packageInfoPath, packageInfo, "utf8");
  index.push(packageInfo.trim());
}

const specialFiles = [
  ["node_modules/electron/dist/LICENSE", "electron/LICENSE"],
  ["node_modules/electron/dist/LICENSES.chromium.html", "electron/LICENSES.chromium.html"],
  ["node_modules/ffmpeg-static/ffmpeg.exe.LICENSE", "ffmpeg/GPL-3.0.txt"],
  ["node_modules/ffmpeg-static/ffmpeg.exe.README", "ffmpeg/BUILD-AND-SOURCE.txt"],
  ["desktop/bin/SHA2-256SUMS", "yt-dlp/SHA2-256SUMS"],
];

for (const [source, target] of specialFiles) {
  await copy(path.join(projectRoot, source), path.join(outputRoot, target));
}

const protobufLicenseDir = path.join(
  outputRoot,
  "npm",
  "bufbuild__protobuf-2.13.0",
);
await copy(
  path.join(projectRoot, "node_modules", "sumchecker", "LICENSE"),
  path.join(protobufLicenseDir, "LICENSE-Apache-2.0.txt"),
);
await copy(
  path.join(
    projectRoot,
    "node_modules",
    "@bufbuild",
    "protobuf",
    "dist",
    "esm",
    "wire",
    "varint.js",
  ),
  path.join(protobufLicenseDir, "BSD-3-Clause-varint-source.js"),
);

const lazyValLicenseDir = path.join(outputRoot, "npm", "lazy-val-1.0.5");
await mkdir(lazyValLicenseDir, { recursive: true });
await writeFile(
  path.join(lazyValLicenseDir, "LICENSE-MIT.txt"),
  `MIT License

Copyright (c) Vladimir Krivosheev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  "utf8",
);

await writeFile(
  path.join(outputRoot, "RUNTIME-PACKAGES.txt"),
  `${index.join("\n\n")}\n`,
  "utf8",
);

console.log(`Prepared license bundle for ${runtimePackages.length} runtime package entries.`);

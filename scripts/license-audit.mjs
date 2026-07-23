import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "TRADEMARKS.md",
  "THIRD_PARTY_NOTICES.md",
  "SECURITY.md",
  "CODE_SIGNING_POLICY.md",
  "docs/FFMPEG_SOURCE.md",
];

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const errors = [];

if (packageJson.license !== "GPL-3.0-or-later") {
  errors.push("package.json license must be GPL-3.0-or-later");
}

for (const relativePath of requiredFiles) {
  try {
    await read(relativePath);
  } catch {
    errors.push(`missing required policy file: ${relativePath}`);
  }
}

const packages = Object.entries(packageLock.packages || {})
  .filter(([packagePath]) => packagePath);
const missingLicenses = [];
for (const [packagePath, metadata] of packages) {
  if (metadata.license) continue;
  try {
    const dependencyPackage = JSON.parse(
      await readFile(path.join(projectRoot, packagePath, "package.json"), "utf8"),
    );
    if (dependencyPackage.license || dependencyPackage.licenses?.length) continue;
  } catch {
    // Report unreadable or incomplete package metadata below.
  }
  missingLicenses.push(packagePath);
}
const suspiciousLicenses = packages
  .filter(([, metadata]) => /UNLICENSED|PROPRIETARY|SEE LICENSE/i.test(metadata.license || ""))
  .map(([packagePath, metadata]) => `${packagePath}: ${metadata.license}`);

if (missingLicenses.length) {
  errors.push(`packages without a declared license: ${missingLicenses.join(", ")}`);
}
if (suspiciousLicenses.length) {
  errors.push(`packages requiring manual license review: ${suspiciousLicenses.join(", ")}`);
}

const ytDlpPath = path.join(projectRoot, "desktop", "bin", "yt-dlp.exe");
const ytDlpHash = createHash("sha256").update(await readFile(ytDlpPath)).digest("hex");
const ytDlpSums = await read("desktop/bin/SHA2-256SUMS");
if (!ytDlpSums.toLowerCase().includes(`${ytDlpHash}  yt-dlp.exe`)) {
  errors.push("desktop/bin/yt-dlp.exe does not match the recorded official SHA2-256SUMS");
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const runtimePackages = packages.filter(([, metadata]) => !metadata.dev);
  const licenseExpressions = [...new Set(runtimePackages.map(([, metadata]) => metadata.license))]
    .sort();
  console.log(`License audit passed: ${runtimePackages.length} runtime package entries`);
  console.log(`Runtime license expressions: ${licenseExpressions.join(", ")}`);
  console.log(`yt-dlp.exe SHA-256 verified: ${ytDlpHash.toUpperCase()}`);
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

async function read(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

const packageJson = JSON.parse(await read("package.json"));
const packageLock = JSON.parse(await read("package-lock.json"));
const appVersion = JSON.parse(await read("public/app-version.json"));
const codeSigningPolicy = await read("CODE_SIGNING_POLICY.md");
const publicCodeSigningPolicy = await read("public/code-signing.html");
const desktopPage = await read("public/desktop.html");
const indexPage = await read("public/index.html");

const version = packageJson.version;
const signPathNotice =
  "Free code signing provided by SignPath.io, certificate by SignPath Foundation";

expect(packageJson.license === "GPL-3.0-or-later", "package license must be GPL-3.0-or-later");
expect(packageLock.version === version, "package-lock.json version must match package.json");
expect(
  packageLock.packages?.[""]?.version === version,
  "package-lock.json root package version must match package.json",
);
expect(appVersion.version === version, "public/app-version.json version must match package.json");
expect(codeSigningPolicy.includes(`아워튜브 ${version}`), "code signing policy must name current version");
expect(codeSigningPolicy.includes(signPathNotice), "code signing policy must include SignPath notice");
expect(
  publicCodeSigningPolicy.includes(signPathNotice),
  "public code signing page must include SignPath notice",
);
expect(codeSigningPolicy.includes("Authors and committers"), "code signing policy must list authors");
expect(codeSigningPolicy.includes("Reviewers"), "code signing policy must list reviewers");
expect(codeSigningPolicy.includes("Signing approver"), "code signing policy must list approver");
expect(desktopPage.includes(version), "desktop download page must name current version");
expect(indexPage.includes(version), "home page must name current version");
expect(
  packageJson.build?.productName === "아워튜브",
  "electron-builder productName must be 아워튜브",
);
expect(
  packageJson.build?.appId === "kr.ourtube.desktop",
  "electron-builder appId must be kr.ourtube.desktop",
);

if (process.env.GITHUB_REF_TYPE === "tag") {
  expect(
    process.env.GITHUB_REF_NAME === `v${version}`,
    `Git tag must be v${version}, received ${process.env.GITHUB_REF_NAME || "(empty)"}`,
  );
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Release metadata verified for OurTube ${version}`);
}

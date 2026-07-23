const RELEASE_OWNER = "hwangseungbo";
const RELEASE_REPOSITORY = "ourtube-releases";
const FALLBACK_VERSION = "0.2.6";
const BOT_PATTERN =
  /bot|crawler|spider|slurp|facebookexternalhit|kakaotalk-scrap|discordbot|twitterbot|preview/i;

async function getCurrentVersion(request) {
  try {
    const versionUrl = new URL("/app-version.json", request.url);
    const response = await fetch(versionUrl, {
      headers: { accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!response.ok) return FALLBACK_VERSION;
    const payload = await response.json();
    return /^\d+\.\d+\.\d+$/.test(payload?.version) ? payload.version : FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

function getInstallerUrl(version) {
  const filename = `OurTube-Setup-${version}.exe`;
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPOSITORY}/releases/download/v${version}/${filename}`;
}

async function ensureSchema(database) {
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS download_counters (
        counter_key TEXT PRIMARY KEY,
        counter_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
}

async function incrementAnonymousCounters(database, dateKey) {
  await ensureSchema(database);
  await database.batch([
    database.prepare(
      `INSERT INTO download_counters (counter_key, counter_value)
       VALUES ('windows_total', 1)
       ON CONFLICT(counter_key) DO UPDATE SET
         counter_value = counter_value + 1,
         updated_at = CURRENT_TIMESTAMP`,
    ),
    database
      .prepare(
        `INSERT INTO download_counters (counter_key, counter_value)
         VALUES (?, 1)
         ON CONFLICT(counter_key) DO UPDATE SET
           counter_value = counter_value + 1,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(`windows_day:${dateKey}`),
  ]);
}

function shouldCountRequest(request) {
  const userAgent = request.headers.get("user-agent") || "";
  return userAgent.length > 0 && !BOT_PATTERN.test(userAgent);
}

async function buildRedirect(request) {
  const version = await getCurrentVersion(request);
  return Response.redirect(getInstallerUrl(version), 302);
}

export async function onRequestGet(context) {
  if (context.env.DOWNLOAD_DB && shouldCountRequest(context.request)) {
    const dateKey = new Date().toISOString().slice(0, 10);
    context.waitUntil(
      incrementAnonymousCounters(context.env.DOWNLOAD_DB, dateKey).catch(() => undefined),
    );
  }

  const response = await buildRedirect(context.request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(null, { status: response.status, headers });
}

export async function onRequestHead(context) {
  const response = await buildRedirect(context.request);
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(null, { status: response.status, headers });
}

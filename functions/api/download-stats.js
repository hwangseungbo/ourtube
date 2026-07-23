const RELEASES_API =
  "https://api.github.com/repos/hwangseungbo/ourtube-releases/releases?per_page=100";
const GITHUB_CACHE_KEY = "github_release_downloads";
const GITHUB_CACHE_SECONDS = 15 * 60;

async function ensureSchema(database) {
  await database.batch([
    database.prepare(
      `CREATE TABLE IF NOT EXISTS download_counters (
        counter_key TEXT PRIMARY KEY,
        counter_value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    ),
    database.prepare(
      `CREATE TABLE IF NOT EXISTS download_metadata (
        metadata_key TEXT PRIMARY KEY,
        metadata_value TEXT NOT NULL,
        updated_at_epoch INTEGER NOT NULL
      )`,
    ),
  ]);
}

async function readClickCounters(database, dateKey) {
  const result = await database
    .prepare(
      `SELECT counter_key, counter_value
       FROM download_counters
       WHERE counter_key IN ('windows_total', ?)`,
    )
    .bind(`windows_day:${dateKey}`)
    .all();

  const counters = new Map(
    (result.results || []).map((row) => [row.counter_key, Number(row.counter_value) || 0]),
  );
  return {
    total: counters.get("windows_total") || 0,
    today: counters.get(`windows_day:${dateKey}`) || 0,
  };
}

function summarizeGitHubDownloads(releases) {
  let total = 0;
  let latest = 0;
  let latestVersion = "";

  const publishedReleases = Array.isArray(releases)
    ? releases.filter((release) => !release.draft && !release.prerelease)
    : [];

  for (const [releaseIndex, release] of publishedReleases.entries()) {
    const installerAssets = Array.isArray(release.assets)
      ? release.assets.filter((asset) => /^OurTube-Setup-\d+\.\d+\.\d+\.exe$/i.test(asset.name))
      : [];
    const releaseDownloads = installerAssets.reduce(
      (sum, asset) => sum + (Number(asset.download_count) || 0),
      0,
    );
    total += releaseDownloads;
    if (releaseIndex === 0) {
      latest = releaseDownloads;
      latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    }
  }

  return { total, latest, latestVersion };
}

async function readCachedGitHubStats(database, nowEpoch) {
  const cached = await database
    .prepare(
      `SELECT metadata_value, updated_at_epoch
       FROM download_metadata
       WHERE metadata_key = ?`,
    )
    .bind(GITHUB_CACHE_KEY)
    .first();

  if (!cached) return null;
  try {
    return {
      value: JSON.parse(cached.metadata_value),
      updatedAt: Number(cached.updated_at_epoch) || 0,
      fresh: nowEpoch - Number(cached.updated_at_epoch) < GITHUB_CACHE_SECONDS,
    };
  } catch {
    return null;
  }
}

async function fetchGitHubStats() {
  const response = await fetch(RELEASES_API, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "OurTube-Download-Stats",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  return summarizeGitHubDownloads(await response.json());
}

async function getGitHubStats(database, nowEpoch) {
  const cached = await readCachedGitHubStats(database, nowEpoch);
  if (cached?.fresh) return { ...cached.value, cached: true };

  try {
    const value = await fetchGitHubStats();
    await database
      .prepare(
        `INSERT INTO download_metadata (metadata_key, metadata_value, updated_at_epoch)
         VALUES (?, ?, ?)
         ON CONFLICT(metadata_key) DO UPDATE SET
           metadata_value = excluded.metadata_value,
           updated_at_epoch = excluded.updated_at_epoch`,
      )
      .bind(GITHUB_CACHE_KEY, JSON.stringify(value), nowEpoch)
      .run();
    return { ...value, cached: false };
  } catch {
    return cached ? { ...cached.value, cached: true, stale: true } : null;
  }
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "public, max-age=60, s-maxage=300",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function onRequestGet(context) {
  if (!context.env.DOWNLOAD_DB) {
    return json({ ok: false, error: "DOWNLOAD_DB binding is not configured." }, 503);
  }

  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const dateKey = now.toISOString().slice(0, 10);

  try {
    await ensureSchema(context.env.DOWNLOAD_DB);
    const [websiteClicks, githubDownloads] = await Promise.all([
      readClickCounters(context.env.DOWNLOAD_DB, dateKey),
      getGitHubStats(context.env.DOWNLOAD_DB, nowEpoch),
    ]);

    return json({
      ok: true,
      generatedAt: now.toISOString(),
      websiteClicks,
      githubDownloads,
      notes: {
        websiteClicks: "홈페이지 설치 버튼을 거친 익명 클릭 횟수",
        githubDownloads: "GitHub 설치 파일 요청 횟수이며 재다운로드와 앱 업데이트가 포함될 수 있음",
      },
    });
  } catch {
    return json({ ok: false, error: "Download statistics are temporarily unavailable." }, 503);
  }
}

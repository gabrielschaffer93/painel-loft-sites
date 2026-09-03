const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { BILLING_PROJECT, getBigQuery } = require('./google');

// Last successful "Atualizar tudo" stays until the next one.
// Memory + local file are fast. BigQuery is the shared source of truth
// so every browser and every Vercel instance sees the same snapshot.
const CACHE_DIR = process.env.VERCEL
  ? os.tmpdir()
  : path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'painel-sites-bq-cache.json');
const REMOTE_TABLE = `\`${BILLING_PROJECT}.${config.cacheDataset}.${config.cacheTable}\``;

const cache = new Map();
let loaded = false;
let loadPromise = null;
let remoteReady = false;

function parseRowsJson(raw) {
  if (raw == null) return null;
  const text = typeof raw === 'string' ? raw : String(raw);
  try {
    const rows = JSON.parse(text);
    return Array.isArray(rows) ? rows : null;
  } catch (e) {
    return null;
  }
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number' && isFinite(value)) return value;
  const n = Number(value);
  if (isFinite(n)) return n;
  const t = Date.parse(String(value));
  return isFinite(t) ? t : 0;
}

function latestLocalAt() {
  let latest = 0;
  cache.forEach(function (entry) {
    if (entry && entry.at > latest) latest = entry.at;
  });
  return latest;
}

function loadFromDisk() {
  try {
    const obj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    Object.keys(obj || {}).forEach(function (id) {
      const entry = obj[id];
      if (entry && entry.rows && entry.at) cache.set(id, entry);
    });
  } catch (e) {}
}

function persistDisk() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const obj = {};
    cache.forEach(function (entry, id) {
      obj[id] = entry;
    });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch (e) {}
}

async function ensureRemoteTable(bq) {
  if (remoteReady) return;
  await bq.query({
    query:
      `CREATE SCHEMA IF NOT EXISTS \`${BILLING_PROJECT}.${config.cacheDataset}\` ` +
      'OPTIONS(location="US")',
    location: 'US',
  });
  await bq.query({
    query:
      `CREATE TABLE IF NOT EXISTS ${REMOTE_TABLE} (` +
      'metric STRING NOT NULL, ' +
      'rows_json STRING NOT NULL, ' +
      'updated_at TIMESTAMP NOT NULL' +
      ')',
    location: 'US',
  });
  remoteReady = true;
}

async function loadFromBigQuery() {
  try {
    const bq = await getBigQuery();
    const [rows] = await bq.query({
      query:
        `SELECT metric, rows_json, UNIX_MILLIS(updated_at) AS at ` +
        `FROM ${REMOTE_TABLE}`,
      location: 'US',
    });

    let remoteLatest = 0;
    const remoteEntries = [];
    (rows || []).forEach(function (row) {
      const metric = row.metric;
      const parsed = parseRowsJson(row.rows_json);
      const at = toMillis(row.at);
      if (!metric || !parsed || !at) return;
      remoteEntries.push({ metric: metric, rows: parsed, at: at });
      if (at > remoteLatest) remoteLatest = at;
    });

    if (!remoteEntries.length) return;
    if (remoteLatest < latestLocalAt()) return;

    remoteEntries.forEach(function (entry) {
      cache.set(entry.metric, { rows: entry.rows, at: entry.at });
    });
    persistDisk();
  } catch (e) {
    // Table may not exist yet, or this credential cannot read it.
  }
}

async function persistRemote(metric, entry) {
  try {
    const bq = await getBigQuery();
    await ensureRemoteTable(bq);
    await bq.query({
      query:
        `MERGE ${REMOTE_TABLE} T ` +
        'USING (SELECT @metric AS metric, @rowsJson AS rows_json, TIMESTAMP_MILLIS(@at) AS updated_at) S ' +
        'ON T.metric = S.metric ' +
        'WHEN MATCHED THEN UPDATE SET rows_json = S.rows_json, updated_at = S.updated_at ' +
        'WHEN NOT MATCHED THEN INSERT (metric, rows_json, updated_at) ' +
        'VALUES (S.metric, S.rows_json, S.updated_at)',
      params: {
        metric: metric,
        rowsJson: JSON.stringify(entry.rows),
        at: entry.at,
      },
      location: 'US',
    });
  } catch (e) {
    console.error('Could not persist dashboard cache to BigQuery:', e.message || e);
  }
}

function ensureLoaded() {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async function () {
    loadFromDisk();
    await loadFromBigQuery();
    loaded = true;
  })();
  return loadPromise;
}

async function get(metric) {
  await ensureLoaded();
  return cache.get(metric) || null;
}

async function set(metric, rows) {
  await ensureLoaded();
  const entry = { rows: rows, at: Date.now() };
  cache.set(metric, entry);
  persistDisk();
  await persistRemote(metric, entry);
}

async function snapshot() {
  await ensureLoaded();
  const metrics = {};
  let latest = 0;
  cache.forEach(function (entry, id) {
    if (!entry || !entry.rows || !entry.at) return;
    metrics[id] = {
      rows: entry.rows,
      cachedAt: new Date(entry.at).toISOString(),
    };
    if (entry.at > latest) latest = entry.at;
  });
  return {
    metrics: metrics,
    updatedAt: latest ? new Date(latest).toISOString() : null,
  };
}

module.exports = { get, set, snapshot };

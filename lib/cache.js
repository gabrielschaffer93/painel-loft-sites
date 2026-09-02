const fs = require('fs');
const os = require('os');
const path = require('path');

// Last successful result stays until someone clicks "Atualizar tudo".
const CACHE_DIR = process.env.VERCEL
  ? os.tmpdir()
  : path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'painel-sites-bq-cache.json');

const cache = new Map();
let loaded = false;

function loadFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    const obj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    Object.keys(obj || {}).forEach(function (id) {
      const entry = obj[id];
      if (entry && entry.rows && entry.at) cache.set(id, entry);
    });
  } catch (e) {}
}

function persist() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const obj = {};
    cache.forEach(function (entry, id) {
      obj[id] = entry;
    });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch (e) {}
}

function get(metric) {
  loadFromDisk();
  return cache.get(metric) || null;
}

function set(metric, rows) {
  loadFromDisk();
  cache.set(metric, { rows: rows, at: Date.now() });
  persist();
}

function snapshot() {
  loadFromDisk();
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

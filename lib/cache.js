const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

const CACHE_TTL_MS = (config.cacheTtlMinutes || 60) * 60 * 1000;
const CACHE_FILE = path.join(os.tmpdir(), 'painel-sites-bq-cache.json');

const cache = new Map();
let loaded = false;

function loadFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    const obj = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    Object.keys(obj || {}).forEach(function (id) {
      const entry = obj[id];
      if (entry && entry.at && Date.now() - entry.at < CACHE_TTL_MS) {
        cache.set(id, entry);
      }
    });
  } catch (e) {}
}

function persist() {
  try {
    const obj = {};
    cache.forEach(function (entry, id) {
      obj[id] = entry;
    });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch (e) {}
}

function get(metric) {
  loadFromDisk();
  const cached = cache.get(metric);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  return null;
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
    if (entry && entry.at && Date.now() - entry.at < CACHE_TTL_MS) {
      metrics[id] = {
        rows: entry.rows,
        cachedAt: new Date(entry.at).toISOString(),
      };
      if (entry.at > latest) latest = entry.at;
    }
  });
  return {
    metrics: metrics,
    updatedAt: latest ? new Date(latest).toISOString() : null,
  };
}

module.exports = { get, set, snapshot, CACHE_TTL_MS };

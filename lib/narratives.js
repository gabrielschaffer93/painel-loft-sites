const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { BILLING_PROJECT, getBigQuery } = require('./google');

const KEYS = ['entregas', 'atencao'];
const EDITOR = String(config.narrativeEditorEmail || '').toLowerCase();
const CACHE_DIR = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '..', '.cache');
const FILE = path.join(CACHE_DIR, 'narratives.json');
const TABLE = `\`${BILLING_PROJECT}.${config.cacheDataset}.dashboard_narratives\``;
const ALLOWED_TAGS = { p: 1, br: 1, strong: 1, em: 1, b: 1, i: 1, ul: 1, ol: 1, li: 1, h2: 1, h3: 1, a: 1 };

let remoteReady = false;

function emptyStore() {
  return { entregas: { html: '', at: 0 }, atencao: { html: '', at: 0 } };
}

function readFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const store = emptyStore();
    KEYS.forEach(function (key) {
      const item = raw && raw[key];
      if (!item) return;
      store[key] = { html: String(item.html || ''), at: Number(item.at) || 0 };
    });
    return store;
  } catch (e) {
    return emptyStore();
  }
}

function writeFile(store) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store));
}

function sanitizeNarrativeHtml(input) {
  let html = String(input || '').slice(0, 20000);
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, function (match, tag, attrs) {
    const name = String(tag || '').toLowerCase();
    if (!ALLOWED_TAGS[name]) return '';
    if (match.charAt(1) === '/') return '</' + name + '>';
    if (name === 'br') return '<br>';
    if (name === 'a') {
      const hrefMatch = String(attrs || '').match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || '') : '';
      if (!/^https?:\/\//i.test(href)) return '<a>';
      return '<a href="' + href.replace(/"/g, '%22') + '" rel="noopener noreferrer" target="_blank">';
    }
    return '<' + name + '>';
  });
  return html.trim();
}

function isEditor(email) {
  return String(email || '').trim().toLowerCase() === EDITOR;
}

async function ensureTable() {
  if (remoteReady) return;
  const bq = await getBigQuery();
  await bq.query({
    query:
      `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
      'narrative_key STRING NOT NULL, html STRING, updated_at TIMESTAMP NOT NULL)',
    location: 'US',
  });
  remoteReady = true;
}

async function readRemote() {
  try {
    await ensureTable();
    const bq = await getBigQuery();
    const [rows] = await bq.query({
      query:
        'SELECT narrative_key, html, UNIX_MILLIS(updated_at) AS at FROM ' + TABLE,
      location: 'US',
    });
    const store = emptyStore();
    (rows || []).forEach(function (row) {
      const key = row.narrative_key;
      if (KEYS.indexOf(key) === -1) return;
      store[key] = { html: String(row.html || ''), at: Number(row.at) || 0 };
    });
    return store;
  } catch (e) {
    return null;
  }
}

async function writeRemote(key, html, at) {
  try {
    await ensureTable();
    const bq = await getBigQuery();
    await bq.query({
      query:
        `MERGE ${TABLE} T ` +
        'USING (SELECT @key AS narrative_key, @html AS html, TIMESTAMP_MILLIS(@at) AS updated_at) S ' +
        'ON T.narrative_key = S.narrative_key ' +
        'WHEN MATCHED THEN UPDATE SET html = S.html, updated_at = S.updated_at ' +
        'WHEN NOT MATCHED THEN INSERT (narrative_key, html, updated_at) VALUES (S.narrative_key, S.html, S.updated_at)',
      params: { key: key, html: html, at: at },
      location: 'US',
    });
  } catch (e) {
    console.error('Could not persist narrative to BigQuery:', e.message || e);
  }
}

function mergeStores(local, remote) {
  const store = emptyStore();
  KEYS.forEach(function (key) {
    const a = local[key] || { html: '', at: 0 };
    const b = remote && remote[key] ? remote[key] : { html: '', at: 0 };
    store[key] = b.at > a.at ? b : a;
  });
  return store;
}

function publicShape(store) {
  return {
    entregas: store.entregas.html || '',
    atencao: store.atencao.html || '',
    editor: EDITOR,
  };
}

async function readAll() {
  const local = readFile();
  const remote = await readRemote();
  const store = mergeStores(local, remote);
  try { writeFile(store); } catch (e) {}
  return publicShape(store);
}

async function save(key, html, email) {
  if (!isEditor(email)) {
    const err = new Error('Sem permissão para editar.');
    err.statusCode = 403;
    throw err;
  }
  if (KEYS.indexOf(key) === -1) {
    const err = new Error('Bloco inválido.');
    err.statusCode = 400;
    throw err;
  }
  const clean = sanitizeNarrativeHtml(html);
  const at = Date.now();
  const store = readFile();
  store[key] = { html: clean, at: at };
  writeFile(store);
  await writeRemote(key, clean, at);
  return publicShape(store);
}

module.exports = { readAll, save, isEditor };

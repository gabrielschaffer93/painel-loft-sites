const { BigQuery } = require('@google-cloud/bigquery');
const { OAuth2Client } = require('google-auth-library');
const { QUERIES } = require('./queries');

// Billing project: tables may live elsewhere, but query cost/quota is billed here.
const BILLING_PROJECT = process.env.BQ_BILLING_PROJECT || 'loft-data-llm-workloads';

// In-memory cache. Vercel reuses the instance across nearby invocations,
// which avoids repeating the same heavy query.
// Default TTL: 1 hour. Override with CACHE_TTL_MINUTES.
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_MINUTES, 10) || 60) * 60 * 1000;
const cache = new Map();

function parseServiceAccount(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e2) {
      throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON (plain or base64).');
    }
  }
}

function getAccessToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header === 'string' && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, '').trim() || null;
  }
  return null;
}

function parseAllowedEmails() {
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function assertGoogleToken(accessToken) {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const err = new Error('Google token is invalid or expired.');
    err.statusCode = 401;
    throw err;
  }
  const profile = await resp.json();
  const email = String(profile.email || '').toLowerCase();
  const allowed = parseAllowedEmails();
  if (allowed && !allowed.includes(email)) {
    const err = new Error('This email is not allowed to query BigQuery in this panel.');
    err.statusCode = 403;
    throw err;
  }
  return email;
}

function getClient(accessToken) {
  if (accessToken) {
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: accessToken });
    return new BigQuery({
      projectId: BILLING_PROJECT,
      authClient,
    });
  }

  const saRaw = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (saRaw) {
    return new BigQuery({
      projectId: BILLING_PROJECT,
      credentials: parseServiceAccount(saRaw),
    });
  }

  // Local fallback: Application Default Credentials
  // (gcloud auth application-default login).
  return new BigQuery({ projectId: BILLING_PROJECT });
}

function toRows(rawRows) {
  if (!rawRows || !rawRows.length) return [];
  const columns = Object.keys(rawRows[0]);
  return rawRows.map((row) =>
    columns.map((col) => {
      const v = row[col];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && v.value !== undefined) return String(v.value);
      return String(v);
    })
  );
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
    return;
  }

  const metric =
    (req.query && req.query.metric) ||
    (req.body && req.body.metric) ||
    null;

  if (!metric) {
    res.status(400).json({ error: 'The "metric" parameter is required.' });
    return;
  }

  // Only known metrics. The client never sends SQL — avoids injection
  // and stops anyone from running arbitrary queries on BigQuery.
  const sql = QUERIES[metric];
  if (!sql) {
    res.status(404).json({
      error: `Unknown metric: "${metric}".`,
      disponiveis: Object.keys(QUERIES),
    });
    return;
  }

  const forceRefresh = String((req.query && req.query.refresh) || '') === '1';
  const cached = cache.get(metric);
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.status(200).json({
      metric,
      rows: cached.rows,
      cached: true,
      cachedAt: new Date(cached.at).toISOString(),
    });
    return;
  }

  try {
    const accessToken = getAccessToken(req);
    if (accessToken) {
      await assertGoogleToken(accessToken);
    }

    const [job] = await getClient(accessToken).createQueryJob({
      query: sql,
      location: 'US',
    });
    const [rawRows] = await job.getQueryResults();
    const rows = toRows(rawRows);

    cache.set(metric, { rows, at: Date.now() });

    res.status(200).json({ metric, rows, cached: false });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const status = err && err.statusCode ? err.statusCode : /quota|exceeded/i.test(msg) ? 429 : 500;
    res.status(status).json({
      metric,
      error: msg,
      quotaExceeded: status === 429,
    });
  }
};

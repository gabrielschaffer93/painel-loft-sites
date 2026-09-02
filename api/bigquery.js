const { BigQuery } = require('@google-cloud/bigquery');
const { OAuth2Client } = require('google-auth-library');
const { QUERIES } = require('./queries');
const cache = require('../lib/cache');
const config = require('../lib/config');

const BILLING_PROJECT = config.billingProject;
const ALLOWED_EMAILS = config.allowedEmails.map((email) => String(email).toLowerCase());

function getAccessToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header === 'string' && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, '').trim() || null;
  }
  return null;
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
  if (!ALLOWED_EMAILS.includes(email)) {
    const err = new Error('This email is not allowed to query BigQuery in this panel.');
    err.statusCode = 403;
    throw err;
  }
  return email;
}

async function requireViewer(req) {
  const accessToken = getAccessToken(req);
  if (accessToken) {
    await assertGoogleToken(accessToken);
    return accessToken;
  }
  // On Vercel the API is public: never run queries without a signed-in Google user.
  if (process.env.VERCEL) {
    const err = new Error('Faça login com Google para atualizar ou ver os dados.');
    err.statusCode = 401;
    throw err;
  }
  return null;
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

  try {
    // Snapshot is the last saved dashboard. Anyone on the allowlist can
    // open the panel and see it; only "Atualizar tudo" hits BigQuery.
    const snapshot = String((req.query && req.query.snapshot) || '') === '1';
    if (snapshot) {
      res.status(200).json(cache.snapshot());
      return;
    }

    const accessToken = await requireViewer(req);

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
    if (!forceRefresh && cached) {
      res.status(200).json({
        metric,
        rows: cached.rows,
        cached: true,
        cachedAt: new Date(cached.at).toISOString(),
      });
      return;
    }

    const [job] = await getClient(accessToken).createQueryJob({
      query: sql,
      location: 'US',
    });
    const [rawRows] = await job.getQueryResults();
    const rows = toRows(rawRows);

    cache.set(metric, rows);

    res.status(200).json({ metric, rows, cached: false });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const status = err && err.statusCode ? err.statusCode : /quota|exceeded/i.test(msg) ? 429 : 500;
    res.status(status).json({
      metric: (req.query && req.query.metric) || (req.body && req.body.metric) || null,
      error: msg,
      quotaExceeded: status === 429,
    });
  }
};

const { BigQuery } = require('@google-cloud/bigquery');
const { GoogleAuth } = require('google-auth-library');

const { QUERIES } = require('./queries');
const cache = require('../lib/cache');
const config = require('../lib/config');

const BILLING_PROJECT = config.billingProject;

/**
 * Cria o cliente de autenticação.
 *
 * LOCAL:
 * Usa automaticamente o Application Default Credentials
 * configurado com:
 *
 *   gcloud auth application-default login
 *
 * VERCEL:
 * Usa a credencial JSON armazenada na variável:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON
 *
 * Essa credencial é a do usuário Gabriel.
 */
function getGoogleAuth() {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (credentialsJson) {
    let credentials;

    try {
      credentials = JSON.parse(credentialsJson);
    } catch (err) {
      throw new Error(
        'A variável GOOGLE_APPLICATION_CREDENTIALS_JSON não contém um JSON válido.'
      );
    }

    return new GoogleAuth({
      credentials,
      projectId: BILLING_PROJECT,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  // Desenvolvimento local:
  // usa automaticamente:
  // %APPDATA%\gcloud\application_default_credentials.json
  return new GoogleAuth({
    projectId: BILLING_PROJECT,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

/**
 * Cria o cliente BigQuery usando UMA ÚNICA identidade:
 * a credencial configurada no backend.
 */
async function getClient() {
  const auth = getGoogleAuth();
  const authClient = await auth.getClient();

  return new BigQuery({
    projectId: BILLING_PROJECT,
    authClient,
  });
}

/**
 * Converte os resultados do BigQuery para o formato
 * esperado pelo frontend.
 */
function toRows(rawRows) {
  if (!rawRows || !rawRows.length) return [];

  const columns = Object.keys(rawRows[0]);

  return rawRows.map((row) =>
    columns.map((col) => {
      const value = row[col];

      if (value === null || value === undefined) {
        return '';
      }

      if (
        typeof value === 'object' &&
        value !== null &&
        value.value !== undefined
      ) {
        return String(value.value);
      }

      return String(value);
    })
  );
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({
      error: 'Method not allowed. Use GET or POST.',
    });
    return;
  }

  try {
    /**
     * Snapshot:
     *
     * Retorna os últimos dados salvos sem executar
     * uma nova consulta no BigQuery.
     */
    const snapshot =
      String((req.query && req.query.snapshot) || '') === '1';

    if (snapshot) {
      res.status(200).json(cache.snapshot());
      return;
    }

    /**
     * Identifica a métrica solicitada.
     */
    const metric =
      (req.query && req.query.metric) ||
      (req.body && req.body.metric) ||
      null;

    if (!metric) {
      res.status(400).json({
        error: 'The "metric" parameter is required.',
      });
      return;
    }

    /**
     * IMPORTANTE:
     *
     * O frontend nunca envia SQL.
     *
     * Ele envia somente o ID da métrica.
     *
     * O SQL correspondente fica no backend,
     * dentro de api/queries.js.
     */
    const sql = QUERIES[metric];

    if (!sql) {
      res.status(404).json({
        error: `Unknown metric: "${metric}".`,
        disponiveis: Object.keys(QUERIES),
      });
      return;
    }

    /**
     * Verifica se já existe resultado em cache.
     */
    const forceRefresh =
      String((req.query && req.query.refresh) || '') === '1';

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

    /**
     * Executa o BigQuery usando a credencial do BACKEND.
     *
     * Não importa qual usuário clicou no botão.
     *
     * Luiza
     * Bertozzo
     * Gabriel
     *
     * todos chegam aqui e a consulta usa a mesma
     * credencial configurada no servidor.
     */
    const bigquery = await getClient();

    const [job] = await bigquery.createQueryJob({
      query: sql,
      location: 'US',
    });

    const [rawRows] = await job.getQueryResults();

    const rows = toRows(rawRows);

    /**
     * Salva o resultado no cache.
     */
    cache.set(metric, rows);

    res.status(200).json({
      metric,
      rows,
      cached: false,
    });
  } catch (err) {
    console.error('Erro ao consultar BigQuery:', err);

    const msg =
      err && err.message
        ? err.message
        : String(err);

    const status =
      err && err.statusCode
        ? err.statusCode
        : /quota|exceeded/i.test(msg)
          ? 429
          : 500;

    res.status(status).json({
      metric:
        (req.query && req.query.metric) ||
        (req.body && req.body.metric) ||
        null,

      error: msg,

      quotaExceeded: status === 429,
    });
  }
};
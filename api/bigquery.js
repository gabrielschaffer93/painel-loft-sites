const { QUERIES } = require('./queries');
const cache = require('../lib/cache');
const { getBigQuery } = require('../lib/google');

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
      res.status(200).json(await cache.snapshot());
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

    const cached = await cache.get(metric);

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
    const bigquery = await getBigQuery();

    const [job] = await bigquery.createQueryJob({
      query: sql,
      location: 'US',
    });

    const [rawRows] = await job.getQueryResults();

    const rows = toRows(rawRows);

    /**
     * Salva o resultado no cache.
     */
    await cache.set(metric, rows);

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
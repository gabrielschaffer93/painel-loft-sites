const { QUERIES } = require('./queries');
const cache = require('../lib/cache');
const { getBigQuery } = require('../lib/google');

/**
 * Converte os resultados do BigQuery para o formato
 * esperado pelo frontend.
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (!inSingle && !inDouble && char === '-' && next === '-') {
      current += char;
      inLineComment = true;
      continue;
    }

    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;

    if (char === ';' && !inSingle && !inDouble) {
      const statement = current.trim();
      if (statement && statement.replace(/--.*$/gm, '').trim()) statements.push(statement);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail && tail.replace(/--.*$/gm, '').trim()) statements.push(tail);
  return statements;
}

function scalar(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.value !== undefined) return String(value.value);
  return String(value);
}

function monthIso(raw) {
  const match = scalar(raw).match(/^(\d{4})-(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-01' : scalar(raw);
}

function asNumber(raw) {
  const n = parseFloat(scalar(raw));
  return Number.isFinite(n) ? n : 0;
}

function statementKind(sql) {
  const text = sql.replace(/--.*$/gm, '');
  if (/LIKE\s+["']%Cross%["']/i.test(text)) return 'cross';
  if (/tipo_pagina\s*=\s*'busca'/i.test(text)) return 'busca';
  if (/tipo_pagina\s*=\s*'detalhe'/i.test(text)) return 'detalhe';
  return '';
}

// The chart needs one row per month. The stored SQL stays the three statements.
function mergeViewsComposicao(parts) {
  const byMonth = new Map();

  function ensure(mes) {
    const key = monthIso(mes);
    if (!byMonth.has(key)) byMonth.set(key, { busca: 0, imovel: 0, cross: 0 });
    return byMonth.get(key);
  }

  parts.forEach(function (part) {
    const kind = statementKind(part.sql);
    (part.rows || []).forEach(function (row) {
      if (kind === 'cross') ensure(row.mes).cross += asNumber(row.quantidade_eventos);
      else if (kind === 'busca') ensure(row.mes).busca += asNumber(row.quantidade_buscas);
      else if (kind === 'detalhe') ensure(row.mes).imovel += asNumber(row.quantidade_buscas);
    });
  });

  return Array.from(byMonth.entries())
    .sort(function (a, b) { return a[0].localeCompare(b[0]); })
    .map(function (entry) {
      const totals = entry[1];
      return [entry[0], String(totals.busca), String(totals.imovel), String(totals.cross)];
    });
}

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

    // Ver Query and Rodar SQL both read this string from api/queries.js.
    if (String((req.query && req.query.sql) || '') === '1') {
      res.status(200).json({ metric, sql });
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

    const statements = splitSqlStatements(sql);
    let rows;

    if (metric === 'views_composicao' && statements.length > 1) {
      const parts = [];
      for (let i = 0; i < statements.length; i++) {
        const [job] = await bigquery.createQueryJob({
          query: statements[i],
          location: 'US',
        });
        const [rawRows] = await job.getQueryResults();
        parts.push({ sql: statements[i], rows: rawRows });
      }
      rows = mergeViewsComposicao(parts);
    } else {
      const [job] = await bigquery.createQueryJob({
        query: sql,
        location: 'US',
      });
      const [rawRows] = await job.getQueryResults();
      rows = toRows(rawRows);
    }

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

module.exports.splitSqlStatements = splitSqlStatements;
module.exports.mergeViewsComposicao = mergeViewsComposicao;
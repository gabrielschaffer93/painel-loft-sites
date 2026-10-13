// BigQuery queries used by the panel.
// Grouped by the chart on screen. Edit the SQL under that chart name.
// The browser never sends SQL. To add a metric, create the key here and use the same id in METRIC_META.

const PORTAL_POR_IMOB = `WITH
imobiliarias_loft_sites AS (
    SELECT DISTINCT
        clientes.id_cliente
        , clientes.nome_cliente
        , clientes.id_database
        , IFNULL(clientes.imoveis_ativos_venda_ver_web, 0) AS imoveis_venda_no_site
        , IFNULL(clientes.imoveis_ativos_locacao_ver_web, 0) AS imoveis_locacao_no_site
        , IFNULL(clientes.imoveis_ativos_venda_ver_web, 0)
            + IFNULL(clientes.imoveis_ativos_locacao_ver_web, 0) AS imoveis_no_site_total
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'
),
imoveis_crm_das_imobs AS (
    SELECT DISTINCT
        imobiliarias_loft_sites.id_cliente
        , imoveis.id_database
        , CAST(imoveis.id_imovel AS STRING) AS id_imovel
    FROM imobiliarias_loft_sites
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS agencias
        ON imobiliarias_loft_sites.id_cliente = agencias.id_imobiliaria
        AND imobiliarias_loft_sites.id_database = agencias.id_database
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\` AS imoveis
        ON agencias.id_database = imoveis.id_database
        AND agencias.id_agencia = imoveis.id_agencia
    WHERE imoveis.exibir_site IS TRUE
        AND NOT STARTS_WITH(UPPER(TRIM(imoveis.status)), 'VENDID')
),
anuncios_portal_publicados AS (
    SELECT DISTINCT
        CAST(portal.id_imovel_vista AS STRING) AS id_imovel_vista
    FROM \`loft-dl-marketplace.gold_supply.listings\` AS portal
    WHERE portal.is_published IS TRUE
        AND portal.id_imovel_vista IS NOT NULL
),
overlap_portal_por_imob AS (
    SELECT
        imoveis_crm_das_imobs.id_cliente
        , COUNT(DISTINCT IF(
            anuncios_portal_publicados.id_imovel_vista IS NOT NULL
            , imoveis_crm_das_imobs.id_imovel
            , NULL
        )) AS imoveis_tambem_no_portal
    FROM imoveis_crm_das_imobs
    LEFT JOIN anuncios_portal_publicados
        ON imoveis_crm_das_imobs.id_imovel = anuncios_portal_publicados.id_imovel_vista
    GROUP BY imoveis_crm_das_imobs.id_cliente
),
por_imobiliaria AS (
    SELECT
        imobiliarias_loft_sites.id_cliente
        , ANY_VALUE(imobiliarias_loft_sites.nome_cliente) AS nome_cliente
        , SUM(imobiliarias_loft_sites.imoveis_no_site_total) AS imoveis_no_site_total
        , SUM(imobiliarias_loft_sites.imoveis_venda_no_site) AS imoveis_venda_no_site
        , SUM(imobiliarias_loft_sites.imoveis_locacao_no_site) AS imoveis_locacao_no_site
        , IFNULL(MAX(overlap_portal_por_imob.imoveis_tambem_no_portal), 0) AS imoveis_portal_loft
    FROM imobiliarias_loft_sites
    LEFT JOIN overlap_portal_por_imob
        ON imobiliarias_loft_sites.id_cliente = overlap_portal_por_imob.id_cliente
    GROUP BY imobiliarias_loft_sites.id_cliente
)
`;

const IMOBILIARIAS_SITES_DISTINCT = `SELECT DISTINCT
        clientes.id_cliente
        , clientes.nome_cliente
        , IFNULL(clientes.imoveis_ativos_venda_ver_web, 0) AS qtd_venda_ver_web
        , IFNULL(clientes.imoveis_ativos_locacao_ver_web, 0) AS qtd_locacao_ver_web
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'`;

// Same membership as Total de Imobiliárias (feature 259), plus financial status.
const BASE_SITES_STATUS = `SELECT
    clientes.id_cliente,
    ANY_VALUE(clientes.status_financeiro) AS status_financeiro
  FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
  INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
    ON clientes.id_cliente = features.id_cliente
  WHERE clientes.status = 'ATIVO'
    AND features.id_feature = 259
    AND features.status = 'ATIVO'
  GROUP BY clientes.id_cliente`;

const LEAD_EVENTOS = `'contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato'`;

// CRM leads that came from our sites: exact vehicle values. Both SITE IMOBILIÁRIA and SITE IMOBILIÁRIO are
// written by the sites (confirmed by product in Oct/2026); the "Ã¡" ones are a broken-accent copy in the CRM data.
const CRM_SITE_VEICULOS = `'SITE IMOBILIÁRIA', 'SITE IMOBILIÃ¡RIA', 'SITE IMOBILIÁRIO', 'SITE IMOBILIÃ¡RIO'`;

// One row per site lead in the CRM (id_database + id_cliente is unique there), for agencies with the Site feature.
// Joined by base AND agency: agencias has one row per agency, so a base-only join repeats each lead.
const CRM_SITE_LEADS = `imobiliarias_feature_ativa AS (
    SELECT DISTINCT
        clientes.id_cliente,
        clientes.id_database
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'
),
leads_site_crm AS (
    SELECT
        f.id_cliente AS id_imobiliaria,
        c.id_database,
        c.id_cliente AS id_lead,
        c.data_cadastro,
        c.origem
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__clientes\` AS c
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS a
        ON c.id_database = a.id_database
        AND c.id_agencia = a.id_agencia
    INNER JOIN imobiliarias_feature_ativa AS f
        ON a.id_imobiliaria = f.id_cliente
        AND a.id_database = f.id_database
    WHERE TRIM(c.veiculo_captacao) IN (${CRM_SITE_VEICULOS})
)`;

const CMS_SITES_LATEST = `WITH latest_per_brand AS (
  SELECT
    loftClientCode,
    brandId,
    newdata,
    createdAt
  FROM \`loft-dl-marketplace.bronze_gtm_capital_v2.brokerEventLog\`
  WHERE brandId IS NOT NULL
  QUALIFY ROW_NUMBER() OVER(
    PARTITION BY brandId
    ORDER BY createdAt DESC
  ) = 1
)
`;

// Sales the agency itself registered. Only these statuses count; "VENDIDO TERCEIROS", proprietário,
// particular and agency-named variants are other channels. Compared on UPPER(TRIM(status_imovel)).
const VENDIDO_IMOBILIARIA_STATUS = `'VENDIDO IMOBILIÁRIA', 'VENDIDO IMOBILIARIA', 'VENDIDO IMOBILIRIA', 'VENDIDO'`;

// One row per sold property (id_database + id_imovel) of Site agencies, sold in 2026.
// The sale date is the last CRM update of the property (best estimate available: after the sale
// the broker has no reason to edit it again). valor_venda is the sale value recorded in the CRM.
const VENDIDOS_IMOBILIARIA = `bases_site AS (
    SELECT
        site.id_database,
        MIN(clientes.nome_cliente) AS primeira_imobiliaria,
        COUNT(DISTINCT clientes.id_cliente) AS qtd_imobiliarias
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    INNER JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS site
        ON site.id_cliente = clientes.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'
    GROUP BY site.id_database
),
imoveis_stage_dedup AS (
    SELECT id_database, id_imovel, data_atualizacao
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\`
    QUALIFY ROW_NUMBER() OVER(PARTITION BY id_database, id_imovel ORDER BY data_atualizacao DESC) = 1
),
vendidos AS (
    SELECT
        imoveis.id_database,
        imoveis.id_imovel,
        imoveis.valor_venda,
        DATE(stage.data_atualizacao) AS data_venda
    FROM \`loft-dl-marketplace.silver_loft_sites.portfolio_imoveis\` AS imoveis
    INNER JOIN bases_site AS b
        ON b.id_database = imoveis.id_database
    INNER JOIN imoveis_stage_dedup AS stage
        ON CAST(imoveis.id_database AS STRING) = CAST(stage.id_database AS STRING)
        AND CAST(imoveis.id_imovel AS STRING) = CAST(stage.id_imovel AS STRING)
    WHERE imoveis.flag_vendido IS TRUE
        AND imoveis.status_exibicao = 'EXIBIR'
        AND UPPER(TRIM(imoveis.status_imovel)) IN (${VENDIDO_IMOBILIARIA_STATUS})
        AND stage.data_atualizacao >= '2026-01-01'
        AND DATE(stage.data_atualizacao) <= CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER(PARTITION BY imoveis.id_database, imoveis.id_imovel ORDER BY imoveis.data_ref DESC) = 1
)`;

const QUERIES = {

  // ---------------------------------------------------------------------------
  // Imobiliárias
  // ---------------------------------------------------------------------------

  // Chart: Indicadores
  // Totals for agencies, sites, visits, published portfolio and portal partners.
  subtotais: `WITH imobiliarias_sites AS (
    ${IMOBILIARIAS_SITES_DISTINCT}
)
SELECT
    COUNT(*) AS qtd_imobiliarias
    , SUM(qtd_venda_ver_web) AS total_imoveis_venda_no_site
    , SUM(qtd_locacao_ver_web) AS total_imoveis_locacao_no_site
    , SUM(qtd_venda_ver_web + qtd_locacao_ver_web) AS total_imoveis_no_site
FROM imobiliarias_sites`,
  // Meta 2026: share of the same agency base with at least one published listing.
  imobs_com_publicados: `WITH imobiliarias_sites AS (
    ${IMOBILIARIAS_SITES_DISTINCT}
)
SELECT
    COUNT(*) AS total_imobiliarias,
    COUNTIF(qtd_venda_ver_web + qtd_locacao_ver_web > 0) AS com_imoveis_publicados
FROM imobiliarias_sites`,
  // Card: Situação financeira — same base as Total de Imobiliárias (ATIVO + feature 259).
  imob_status_financeiro: `WITH base AS (
    ${BASE_SITES_STATUS}
)
SELECT
  COUNT(*) AS total_imobiliarias,
  COUNTIF(status_financeiro = 'Regular') AS regular,
  COUNTIF(REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(status_financeiro, '')), r'bloquead')) AS bloqueado,
  COUNTIF(REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(status_financeiro, '')), r'inadimplen')) AS inadimplente
FROM base`,
  // Cards (Imobiliárias) and volume pills (Tráfego, Leads): current month to date vs the same days of the previous month.
  // "Current month" is the month of the last day with data (events load D-1),
  // so on the 1st it still compares the full previous month. DATE_SUB clamps
  // Oct 31 to Sep 30, so a longer month is compared with the whole shorter one.
  imob_mes_atual: `WITH ${CRM_SITE_LEADS},
ref AS (
  SELECT MAX(data_ref) AS ref_date
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE nome_evento = 'pageview'
    AND data_ref BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 45 DAY) AND CURRENT_DATE()
),
periodos AS (
  SELECT 'atual' AS periodo, DATE_TRUNC(ref_date, MONTH) AS inicio, ref_date AS fim FROM ref
  UNION ALL
  SELECT 'anterior', DATE_SUB(DATE_TRUNC(ref_date, MONTH), INTERVAL 1 MONTH), DATE_SUB(ref_date, INTERVAL 1 MONTH) FROM ref
),
eventos AS (
  SELECT p.periodo, e.nome_cliente, e.nome_evento, e.tipo_pagina, e.tipo_evento
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\` AS e
  INNER JOIN periodos AS p
    ON e.data_ref BETWEEN p.inicio AND p.fim
  WHERE e.data_ref >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 2 MONTH)
),
leads_por_imob AS (
  SELECT periodo, nome_cliente, COUNTIF(tipo_evento IN (${LEAD_EVENTOS})) AS leads
  FROM eventos
  WHERE nome_cliente IS NOT NULL AND nome_cliente != ''
  GROUP BY periodo, nome_cliente
),
sem_leads AS (
  SELECT periodo, COUNTIF(leads = 0) AS sem_leads, COUNT(*) AS com_evento
  FROM leads_por_imob
  GROUP BY periodo
),
views AS (
  SELECT
    periodo,
    COUNTIF(nome_evento = 'pageview' AND tipo_pagina = 'detalhe') AS detalhe,
    COUNTIF(nome_evento = 'pageview') AS pageviews,
    COUNTIF(nome_evento = 'pageview' AND tipo_pagina = 'busca') AS busca,
    COUNTIF(tipo_evento IN (${LEAD_EVENTOS})) AS leads
  FROM eventos
  GROUP BY periodo
),
crm_interesse AS (
  -- Same interest rule as leads_crm_status: Aluguel first, then Venda, the rest is Outros.
  SELECT
    p.periodo,
    l.id_lead,
    REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(l.origem, '')), r'alug|loca') AS is_aluguel,
    REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(l.origem, '')), r'venda|compr') AS is_venda
  FROM periodos AS p
  LEFT JOIN leads_site_crm AS l
    ON l.data_cadastro BETWEEN p.inicio AND p.fim
),
crm AS (
  SELECT
    periodo,
    COUNT(id_lead) AS crm,
    COUNTIF(id_lead IS NOT NULL AND NOT is_aluguel AND is_venda) AS crm_venda,
    COUNTIF(id_lead IS NOT NULL AND is_aluguel) AS crm_aluguel,
    COUNTIF(id_lead IS NOT NULL AND NOT is_aluguel AND NOT is_venda) AS crm_outros
  FROM crm_interesse
  GROUP BY periodo
),
novas AS (
  SELECT p.periodo, COUNT(s.id_database) AS novas
  FROM periodos AS p
  LEFT JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS s
    ON CAST(s.data_criacao AS DATE) BETWEEN p.inicio AND p.fim
  GROUP BY p.periodo
),
por_periodo AS (
  SELECT p.periodo, p.inicio, p.fim, n.novas, sl.sem_leads, sl.com_evento, v.detalhe, v.pageviews, v.busca, v.leads, cr.crm, cr.crm_venda, cr.crm_aluguel, cr.crm_outros
  FROM periodos AS p
  LEFT JOIN novas AS n USING (periodo)
  LEFT JOIN sem_leads AS sl USING (periodo)
  LEFT JOIN views AS v USING (periodo)
  LEFT JOIN crm AS cr USING (periodo)
)
SELECT
  FORMAT_DATE('%Y-%m-%d', MAX(IF(periodo = 'atual', fim, NULL))) AS dados_ate,
  FORMAT_DATE('%Y-%m-%d', MAX(IF(periodo = 'anterior', fim, NULL))) AS anterior_ate,
  MAX(IF(periodo = 'atual', novas, NULL)) AS novas_atual,
  MAX(IF(periodo = 'anterior', novas, NULL)) AS novas_anterior,
  MAX(IF(periodo = 'atual', sem_leads, NULL)) AS sem_leads_atual,
  MAX(IF(periodo = 'anterior', sem_leads, NULL)) AS sem_leads_anterior,
  MAX(IF(periodo = 'atual', com_evento, NULL)) AS com_evento_atual,
  MAX(IF(periodo = 'anterior', com_evento, NULL)) AS com_evento_anterior,
  MAX(IF(periodo = 'atual', detalhe, NULL)) AS detalhe_atual,
  MAX(IF(periodo = 'anterior', detalhe, NULL)) AS detalhe_anterior,
  MAX(IF(periodo = 'atual', pageviews, NULL)) AS pageviews_atual,
  MAX(IF(periodo = 'anterior', pageviews, NULL)) AS pageviews_anterior,
  MAX(IF(periodo = 'atual', busca, NULL)) AS busca_atual,
  MAX(IF(periodo = 'anterior', busca, NULL)) AS busca_anterior,
  MAX(IF(periodo = 'atual', leads, NULL)) AS leads_atual,
  MAX(IF(periodo = 'anterior', leads, NULL)) AS leads_anterior,
  MAX(IF(periodo = 'atual', crm, NULL)) AS crm_atual,
  MAX(IF(periodo = 'anterior', crm, NULL)) AS crm_anterior,
  MAX(IF(periodo = 'atual', crm_venda, NULL)) AS crm_venda_atual,
  MAX(IF(periodo = 'anterior', crm_venda, NULL)) AS crm_venda_anterior,
  MAX(IF(periodo = 'atual', crm_aluguel, NULL)) AS crm_aluguel_atual,
  MAX(IF(periodo = 'anterior', crm_aluguel, NULL)) AS crm_aluguel_anterior,
  MAX(IF(periodo = 'atual', crm_outros, NULL)) AS crm_outros_atual,
  MAX(IF(periodo = 'anterior', crm_outros, NULL)) AS crm_outros_anterior
FROM por_periodo`,
  portal_com_count: PORTAL_POR_IMOB + `SELECT COUNT(*) AS total_imobiliarias_no_portal
FROM por_imobiliaria
WHERE imoveis_portal_loft > 0`,

  // Chart: Novas imobiliárias por período
  novas_imob: `SELECT DATE_TRUNC(data_criacao, MONTH) AS mes_criacao, COUNT(id_database) AS total_sites_criados
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE data_criacao >= '2026-01-01'
GROUP BY mes_criacao
ORDER BY mes_criacao`,

  // Chart: Imobiliárias por template
  // The Meta card uses this same query plus subtotais.
  template: `SELECT template, COUNT(id_site_cms) AS total_imobs_por_template
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE status_site IN ('ATIVO') AND (template IS NOT NULL AND template != '')
GROUP BY template
ORDER BY total_imobs_por_template DESC`,

  // Card: Templates que mais convertem
  // "Sem template" is excluded: those clients are no longer in the portfolio.
  tmpl_conversao: `WITH ev AS (
  SELECT
    id_site_cms,
    ANY_VALUE(template)       AS template_ev,
    COUNT(tipo_evento)        AS leads,
    COUNT(DISTINCT id_sessao) AS sessoes_com_lead
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  GROUP BY id_site_cms
),
sites AS (
  SELECT
    id_site_cms,
    template,
    (status_site = 'ATIVO' AND status = 'ATIVO'
     AND NOT ENDS_WITH(LOWER(IFNULL(hostname, '')), 'loftpreview.com.br')) AS ativo
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
),
base AS (
  SELECT
    COALESCE(s.template, ev.template_ev, 'Sem template') AS template,
    IFNULL(s.ativo, FALSE) AS ativo,
    ev.leads,
    ev.sessoes_com_lead AS sessoes
  FROM ev
  LEFT JOIN sites s ON s.id_site_cms = ev.id_site_cms
  UNION ALL
  SELECT s.template, TRUE, 0, 0
  FROM sites s
  LEFT JOIN ev ON ev.id_site_cms = s.id_site_cms
  WHERE s.ativo AND ev.id_site_cms IS NULL
)
SELECT
  template,
  SUM(leads)                                                  AS leads,
  ROUND(SUM(leads) / SUM(SUM(leads)) OVER () * 100, 1)        AS pct_leads,
  SUM(sessoes)                                                AS sessoes_com_lead,
  COUNTIF(ativo)                                              AS sites_ativos,
  ROUND(SUM(IF(ativo, leads, 0)) / NULLIF(COUNTIF(ativo), 0)) AS leads_por_site_ativo,
  APPROX_QUANTILES(IF(ativo, leads, NULL), 2)[OFFSET(1)]      AS mediana_site_ativo
FROM base
WHERE template != 'Sem template'
GROUP BY template
ORDER BY leads DESC`,

  // Chart: No Portal Loft
  portal_cobertura: PORTAL_POR_IMOB + `SELECT
    (SELECT COUNT(*) FROM (${IMOBILIARIAS_SITES_DISTINCT})) AS total_imobiliarias_base
    , COUNTIF(imoveis_portal_loft > 0) AS total_imobiliarias_portal
    , SUM(imoveis_no_site_total) AS total_imoveis_base
    , SUM(imoveis_portal_loft) AS total_imoveis_portal
FROM por_imobiliaria`,
  portal_com: PORTAL_POR_IMOB + `SELECT
    id_cliente
    , nome_cliente
    , imoveis_no_site_total
    , imoveis_venda_no_site
    , imoveis_locacao_no_site
    , imoveis_portal_loft
FROM por_imobiliaria
WHERE imoveis_portal_loft > 0
ORDER BY imoveis_portal_loft DESC
LIMIT 20`,

  // ---------------------------------------------------------------------------
  // Tráfego
  // ---------------------------------------------------------------------------

  // Chart: Indicadores
  // Total de pageviews for the Leads tab.
  pageviews: `SELECT COUNT(nome_evento) AS total_pageviews
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND data_ref BETWEEN "2026-01-01" AND CURRENT_DATE()`,

  // Chart: Composição das views
  // Mix do período uses this same query.
  views_composicao: `SELECT
  FORMAT_DATE('%Y-%m', data_ref) AS mes,
  CASE
    WHEN nome_evento LIKE '%Cross%' THEN nome_evento
    WHEN tipo_pagina = 'busca'      THEN 'pageview_busca'
    WHEN tipo_pagina = 'detalhe'    THEN 'pageview_detalhe'
  END AS metrica,
  COUNT(*) AS quantidade
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE data_ref >= '2026-01-01'
  AND data_ref <  '2027-01-01'
  AND (
    nome_evento LIKE '%Cross%'
    OR (nome_evento = 'pageview' AND tipo_pagina IN ('busca', 'detalhe'))
  )
GROUP BY mes, metrica
ORDER BY mes DESC, quantidade DESC`,

  // Chart: Leads por canal — origem_trafego grouped into channels, last 9 months.
  // Capitalized names (Google, Bing) are referrers; lowercase ones (google, ig, fb) are utm_source.
  trafego_canais: `WITH eventos AS (
  SELECT
    DATE_TRUNC(data_ref, MONTH) AS mes,
    LOWER(TRIM(IFNULL(origem_trafego, ''))) AS origem,
    nome_evento,
    tipo_evento
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE data_ref >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 8 MONTH)
    AND data_ref <= CURRENT_DATE()
    AND (nome_evento = 'pageview' OR tipo_evento IN (${LEAD_EVENTOS}))
),
canais AS (
  SELECT
    mes,
    CASE
      WHEN origem = '' THEN 'Direto / sem origem'
      WHEN REGEXP_CONTAINS(origem, r'google-?ads|adwords|^gads$|syndicatedsearch|doubleclick|^cpc$') THEN 'Google Ads'
      WHEN REGEXP_CONTAINS(origem, r'google') THEN 'Google'
      WHEN REGEXP_CONTAINS(origem, r'chatgpt|openai|perplexity|gemini|copilot|claude') THEN 'IA'
      WHEN REGEXP_CONTAINS(origem, r'^ig$|instagram') THEN 'Instagram'
      WHEN REGEXP_CONTAINS(origem, r'^fb$|facebook|^an$') THEN 'Facebook'
      WHEN REGEXP_CONTAINS(origem, r'bing|yahoo|duckduckgo|ecosia|yandex|baidu') THEN 'Outros buscadores'
      WHEN REGEXP_CONTAINS(origem, r'youtube') THEN 'YouTube'
      WHEN REGEXP_CONTAINS(origem, r'linktr\\.ee|l\\.wl\\.co|whatsapp|wa\\.me') THEN 'Links (bio e WhatsApp)'
      ELSE 'Outros'
    END AS canal,
    nome_evento,
    tipo_evento
  FROM eventos
)
SELECT
  FORMAT_DATE('%Y-%m-01', mes) AS mes,
  canal,
  COUNTIF(nome_evento = 'pageview') AS pageviews,
  COUNTIF(tipo_evento IN (${LEAD_EVENTOS})) AS leads
FROM canais
GROUP BY mes, canal
ORDER BY mes, leads DESC`,

  // Chart: Total de pageviews por mês
  // The card Total de pageviews uses pageviews above and this monthly query.
  pageviews_mes: `SELECT DATE_TRUNC(DATE(data_ref), MONTH) AS mes_referencia, COUNT(nome_evento) AS total_pageviews
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_referencia
ORDER BY mes_referencia`,

  usuarios_mes: `SELECT DATE_TRUNC(EVE.data_ref, MONTH) AS mes, COUNT(DISTINCT EVE.id_usuario) AS total_usuarios_unicos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS IMO
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.eventos_gtm\` AS EVE ON IMO.hostname = EVE.hostname
WHERE EVE.data_ref >= '2026-01-01' AND EVE.data_ref <= CURRENT_DATE()
GROUP BY mes
ORDER BY mes`,

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------

  // Chart: Total de Leads por mês
  // The indicator Total de Leads uses total_leads.
  total_leads: `SELECT COUNT(tipo_evento) AS total_leads
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')`,
  leads_mes: `SELECT DATE_TRUNC(data_ref, MONTH) AS mes_referencia, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_referencia
ORDER BY mes_referencia`,

  // Chart: Leads por tipo — one row per month so the card can show the current month.
  leads_tipo: `SELECT DATE_TRUNC(data_ref, MONTH) AS mes_referencia, nome_evento, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_referencia, nome_evento
ORDER BY mes_referencia, total_eventos DESC`,

  // Chart: Cadastrados no CRM por mês
  leads_crm_mes: `WITH ${CRM_SITE_LEADS}
SELECT
    DATE_TRUNC(data_cadastro, MONTH) AS mes_cadastro,
    COUNT(*) AS total_leads
FROM leads_site_crm
WHERE data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_cadastro
ORDER BY mes_cadastro`,

  // Chart: Leads cadastrados CRM por Status (Venda vs Aluguel, month by month)
  leads_crm_status: `WITH ${CRM_SITE_LEADS}
SELECT
    DATE_TRUNC(data_cadastro, MONTH) AS mes_cadastro,
    CASE
      WHEN REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(origem, '')), r'alug|loca') THEN 'Aluguel'
      WHEN REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(origem, '')), r'venda|compr') THEN 'Venda'
      ELSE 'Outros'
    END AS status,
    COUNT(*) AS total_leads
FROM leads_site_crm
WHERE data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_cadastro, status
ORDER BY mes_cadastro, status`,

  // Chart: Média de leads por imobiliária — only agencies that received >= 1 site lead in the CRM that month.
  leads_crm_por_imob: `WITH ${CRM_SITE_LEADS},
por_imob AS (
    SELECT DATE_TRUNC(data_cadastro, MONTH) AS mes, id_imobiliaria, COUNT(*) AS leads
    FROM leads_site_crm
    WHERE data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
    GROUP BY mes, id_imobiliaria
)
SELECT
    mes,
    COUNT(*) AS imobs_com_lead,
    SUM(leads) AS leads,
    AVG(leads) AS media_leads
FROM por_imob
GROUP BY mes
ORDER BY mes`,

  // Chart: Cadastrados no CRM
  // Agencies that received CRM leads in at least 2 of the 3 months before the last closed month
  // and none since the start of the last closed month. Agencies whose CRM base is missing never
  // had leads here, so they don't show up as false alarms.
  imob_parou_leads: `WITH ${CRM_SITE_LEADS},
ref AS (
    SELECT DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH), MONTH) AS ultimo_fechado
),
por_mes AS (
    SELECT l.id_imobiliaria, DATE_TRUNC(l.data_cadastro, MONTH) AS mes, COUNT(*) AS leads, MAX(l.data_cadastro) AS ultimo_lead
    FROM leads_site_crm AS l
    CROSS JOIN ref
    WHERE l.data_cadastro >= DATE_SUB(ref.ultimo_fechado, INTERVAL 3 MONTH)
      AND l.data_cadastro <= CURRENT_DATE()
    GROUP BY l.id_imobiliaria, mes
),
resumo AS (
    SELECT
        p.id_imobiliaria,
        SUM(IF(p.mes < ref.ultimo_fechado, p.leads, 0)) AS leads_3_meses_antes,
        COUNTIF(p.mes < ref.ultimo_fechado) AS meses_com_lead_antes,
        SUM(IF(p.mes >= ref.ultimo_fechado, p.leads, 0)) AS leads_desde_entao,
        MAX(p.ultimo_lead) AS ultimo_lead
    FROM por_mes AS p
    CROSS JOIN ref
    GROUP BY p.id_imobiliaria
),
cliente AS (
    SELECT id_cliente, ANY_VALUE(nome_cliente) AS nome_cliente, ANY_VALUE(status_financeiro) AS status_financeiro
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\`
    GROUP BY id_cliente
),
site AS (
    SELECT id_cliente, STRING_AGG(DISTINCT hostname, ', ') AS sites
    FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
    WHERE hostname IS NOT NULL AND data_exclusao IS NULL
    GROUP BY id_cliente
)
SELECT
    r.id_imobiliaria,
    c.nome_cliente,
    c.status_financeiro,
    s.sites,
    r.leads_3_meses_antes,
    ROUND(r.leads_3_meses_antes / 3, 1) AS media_mensal_antes,
    r.ultimo_lead
FROM resumo AS r
LEFT JOIN cliente AS c ON c.id_cliente = r.id_imobiliaria
LEFT JOIN site AS s ON s.id_cliente = r.id_imobiliaria
WHERE r.meses_com_lead_antes >= 2
  AND r.leads_desde_entao = 0
ORDER BY r.leads_3_meses_antes DESC`,

  // Sites created in the last 90 days whose agency has no CRM lead since the site went live.
  // crm_disponivel = false means the agency's CRM base is not in the staging tables (data gap, not a site problem).
  novos_sem_primeiro_lead: `WITH ${CRM_SITE_LEADS},
novos AS (
    SELECT
        s.id_cliente,
        ANY_VALUE(s.id_database) AS id_database,
        ANY_VALUE(s.nome_cliente) AS nome_cliente,
        STRING_AGG(DISTINCT s.hostname, ', ') AS sites,
        MIN(s.data_criacao) AS data_criacao
    FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS s
    INNER JOIN imobiliarias_feature_ativa AS f ON f.id_cliente = s.id_cliente
    WHERE s.data_criacao >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
      AND s.data_exclusao IS NULL
    GROUP BY s.id_cliente
),
com_lead AS (
    SELECT l.id_imobiliaria
    FROM leads_site_crm AS l
    INNER JOIN novos AS n ON n.id_cliente = l.id_imobiliaria AND l.data_cadastro >= n.data_criacao
    GROUP BY l.id_imobiliaria
),
bases_crm AS (
    SELECT DISTINCT id_database
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\`
),
uso AS (
    SELECT
        e.id_cliente,
        COUNTIF(e.nome_evento = 'pageview') AS pageviews,
        COUNTIF(e.tipo_evento IN (${LEAD_EVENTOS})) AS cliques_contato
    FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\` AS e
    INNER JOIN novos AS n ON n.id_cliente = e.id_cliente
    WHERE e.data_ref >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
      AND e.data_ref >= n.data_criacao
    GROUP BY e.id_cliente
)
SELECT
    n.id_cliente,
    n.nome_cliente,
    n.sites,
    n.data_criacao,
    DATE_DIFF(CURRENT_DATE(), n.data_criacao, DAY) AS dias_no_ar,
    COALESCE(u.pageviews, 0) AS pageviews,
    COALESCE(u.cliques_contato, 0) AS cliques_contato,
    b.id_database IS NOT NULL AS crm_disponivel
FROM novos AS n
LEFT JOIN com_lead AS cl ON cl.id_imobiliaria = n.id_cliente
LEFT JOIN uso AS u ON u.id_cliente = n.id_cliente
LEFT JOIN bases_crm AS b ON b.id_database = n.id_database
WHERE cl.id_imobiliaria IS NULL
ORDER BY dias_no_ar DESC`,

  leads_crm: `WITH ${CRM_SITE_LEADS}
SELECT
    COUNT(*) AS total_leads_crm
FROM leads_site_crm`,

  // Chart: Imobiliárias sem leads por mês
  // Also feeds Saúde da base and the year-end projection on the Leads tab.
  imob_sem_leads: `WITH LeadsPorMes AS (
  SELECT
    DATE_TRUNC(data_ref, MONTH) AS mes,
    nome_cliente,
    COUNT(CASE WHEN tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato') THEN 1 END) AS total_leads
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE
    (nome_cliente IS NOT NULL AND nome_cliente != '')
    AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
  GROUP BY
    mes,
    nome_cliente
)
SELECT
  mes,
  COUNTIF(total_leads = 0) AS imobiliarias_sem_leads,
  COUNT(*) AS imobiliarias_com_evento
FROM LeadsPorMes
GROUP BY
  mes
ORDER BY
  mes`,

  // Product-base monthly health + projection inputs (Regular + has Site).
  saude_base_mes: `WITH
params AS (
  SELECT
    DATE '2025-12-01' AS start_lag,
    DATE '2026-01-01' AS start_out,
    DATE_TRUNC(CURRENT_DATE(), MONTH) AS end_mes
),
meses AS (
  SELECT mes
  FROM UNNEST(GENERATE_DATE_ARRAY(
    (SELECT start_lag FROM params),
    (SELECT end_mes FROM params),
    INTERVAL 1 MONTH
  )) AS mes
),
base_produto AS (
  SELECT
    id_cliente,
    nome_cliente,
    plano,
    plano_agrupado,
    combinacao_produtos,
    status_financeiro,
    data_previsao_cancelamento
  FROM \`loft-dl-marketplace.silver_product_vista.clientes\`
  WHERE status = 'ATIVO'
    AND has_site IS TRUE
    AND status_financeiro = 'Regular'
),
fora_controle AS (
  SELECT id_cliente
  FROM \`loft-dl-marketplace.silver_product_vista.clientes\`
  WHERE status = 'ATIVO'
    AND has_site IS TRUE
    AND REGEXP_CONTAINS(NORMALIZE_AND_CASEFOLD(IFNULL(status_financeiro, '')), r'bloquead|inadimplen')
),
eventos AS (
  SELECT
    DATE_TRUNC(data_ref, MONTH) AS mes,
    data_ref,
    id_cliente,
    tipo_evento,
    nome_evento,
    tipo_pagina
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE data_ref >= (SELECT start_lag FROM params)
    AND data_ref < DATE_ADD((SELECT end_mes FROM params), INTERVAL 1 MONTH)
    AND id_cliente IS NOT NULL
),
mensal AS (
  SELECT
    e.mes,
    e.id_cliente,
    COUNTIF(e.nome_evento = 'pageview') AS pageviews,
    COUNTIF(e.nome_evento = 'pageview' AND e.tipo_pagina = 'detalhe') AS detalhe,
    COUNTIF(e.tipo_evento IN (
      'contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato'
    )) AS leads
  FROM eventos e
  INNER JOIN base_produto b
    ON e.id_cliente = b.id_cliente
  GROUP BY 1, 2
),
fora_leads AS (
  SELECT
    e.mes,
    e.id_cliente,
    COUNTIF(e.tipo_evento IN (
      'contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato'
    )) AS leads
  FROM eventos e
  INNER JOIN fora_controle f
    ON e.id_cliente = f.id_cliente
  GROUP BY 1, 2
),
dias_mes AS (
  SELECT
    DATE_TRUNC(data_ref, MONTH) AS mes,
    COUNT(DISTINCT data_ref) AS dias_com_dado
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE nome_evento = 'pageview'
    AND data_ref >= (SELECT start_out FROM params)
    AND data_ref < DATE_ADD((SELECT end_mes FROM params), INTERVAL 1 MONTH)
  GROUP BY 1
),
grid AS (
  SELECT m.mes, b.id_cliente
  FROM meses m
  CROSS JOIN base_produto b
),
grid_vals AS (
  SELECT
    g.mes,
    g.id_cliente,
    IFNULL(mn.pageviews, 0) AS pageviews,
    IFNULL(mn.detalhe, 0) AS detalhe,
    IFNULL(mn.leads, 0) AS leads
  FROM grid g
  LEFT JOIN mensal mn
    ON g.mes = mn.mes
    AND g.id_cliente = mn.id_cliente
),
with_prev AS (
  SELECT
    gv.*,
    LAG(gv.leads) OVER (PARTITION BY gv.id_cliente ORDER BY gv.mes) AS leads_prev
  FROM grid_vals gv
),
ativos AS (
  SELECT
    mes,
    COUNT(*) AS sites_ativos,
    APPROX_QUANTILES(leads, 100)[OFFSET(50)] AS mediana_leads,
    AVG(leads) AS media_leads
  FROM with_prev
  WHERE pageviews >= 1
  GROUP BY mes
),
ranked AS (
  SELECT
    mes,
    leads,
    NTILE(10) OVER (PARTITION BY mes ORDER BY leads DESC) AS decil
  FROM with_prev
  WHERE leads > 0
),
conc AS (
  SELECT
    mes,
    SUM(IF(decil = 1, leads, 0)) AS leads_top,
    SUM(leads) AS leads_all
  FROM ranked
  GROUP BY mes
),
fora_mes AS (
  SELECT
    m.mes,
    COUNT(*) AS fora_controle,
    COUNTIF(IFNULL(fl.leads, 0) = 0) AS fora_controle_sem_lead
  FROM meses m
  CROSS JOIN fora_controle f
  LEFT JOIN fora_leads fl
    ON fl.mes = m.mes
    AND fl.id_cliente = f.id_cliente
  GROUP BY m.mes
),
qualidade AS (
  SELECT COUNT(*) AS previsao_vencida
  FROM base_produto
  WHERE data_previsao_cancelamento IS NOT NULL
    AND DATE(data_previsao_cancelamento) < CURRENT_DATE()
)
SELECT
  FORMAT_DATE('%Y-%m-01', w.mes) AS mes,
  ANY_VALUE(d.dias_com_dado) AS dias_com_dado,
  COUNT(*) AS base_produto,
  COUNTIF(w.leads >= 1) AS com_lead,
  SAFE_DIVIDE(COUNTIF(w.leads >= 1), COUNT(*)) * 100 AS ativacao_pct,
  COUNTIF(w.leads = 0 AND IFNULL(w.leads_prev, 0) = 0) AS em_risco,
  ANY_VALUE(a.sites_ativos) AS sites_ativos,
  ANY_VALUE(a.mediana_leads) AS mediana_leads,
  ANY_VALUE(a.media_leads) AS media_leads,
  SUM(w.leads) AS leads_total,
  SAFE_DIVIDE(ANY_VALUE(c.leads_top), ANY_VALUE(c.leads_all)) * 100 AS concentracao_pct,
  SUM(w.pageviews) AS pageviews,
  SUM(w.detalhe) AS detalhe_views,
  SAFE_DIVIDE(SUM(w.leads), SUM(w.pageviews)) * 1000 AS leads_por_1000_pv,
  ANY_VALUE(f.fora_controle) AS fora_controle,
  ANY_VALUE(f.fora_controle_sem_lead) AS fora_controle_sem_lead,
  ANY_VALUE(q.previsao_vencida) AS previsao_vencida
FROM with_prev w
LEFT JOIN dias_mes d ON d.mes = w.mes
LEFT JOIN ativos a ON a.mes = w.mes
LEFT JOIN conc c ON c.mes = w.mes
LEFT JOIN fora_mes f ON f.mes = w.mes
CROSS JOIN qualidade q
WHERE w.mes >= (SELECT start_out FROM params)
GROUP BY w.mes
ORDER BY w.mes`,

  // Site conversion: leads per 1.000 pageviews on Regular agencies only.
  saude_conversao: `WITH
params AS (
  SELECT
    DATE '2026-01-01' AS start_mes,
    DATE_TRUNC(CURRENT_DATE(), MONTH) AS end_mes
),
base_regular AS (
  SELECT id_cliente
  FROM (${BASE_SITES_STATUS})
  WHERE status_financeiro = 'Regular'
),
eventos AS (
  SELECT
    DATE_TRUNC(e.data_ref, MONTH) AS mes,
    e.data_ref,
    e.id_cliente,
    e.tipo_evento,
    e.nome_evento
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\` e
  INNER JOIN base_regular b
    ON e.id_cliente = b.id_cliente
  WHERE e.data_ref BETWEEN (SELECT start_mes FROM params) AND CURRENT_DATE()
    AND e.id_cliente IS NOT NULL
)
SELECT
  FORMAT_DATE('%Y-%m-01', mes) AS mes,
  COUNTIF(tipo_evento IN (${LEAD_EVENTOS})) AS leads,
  COUNTIF(nome_evento = 'pageview') AS pageviews,
  SAFE_DIVIDE(
    COUNTIF(tipo_evento IN (${LEAD_EVENTOS})),
    COUNTIF(nome_evento = 'pageview')
  ) * 1000 AS leads_por_1000_pv,
  COUNT(DISTINCT data_ref) AS dias
FROM eventos
GROUP BY mes
ORDER BY mes`,

  // Detail table: agencies with site events and zero leads in the month, plus Vista plan/churn fields.
  imob_sem_leads_detalhe: `WITH LeadsPorMes AS (
  SELECT
    DATE_TRUNC(data_ref, MONTH) AS mes,
    id_cliente,
    nome_cliente,
    COUNT(CASE WHEN tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato') THEN 1 END) AS total_leads
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE
    (nome_cliente IS NOT NULL AND nome_cliente != '')
    AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
  GROUP BY
    mes,
    id_cliente,
    nome_cliente
),
status_cliente AS (
  SELECT
    id_cliente,
    plano AS plano_cliente,
    data_previsao_cancelamento,
    plano_agrupado,
    combinacao_produtos,
    status_financeiro
  FROM \`loft-dl-marketplace.silver_product_vista.clientes\`
)
SELECT
  LS.mes,
  LS.id_cliente,
  LS.nome_cliente,
  SC.status_financeiro,
  SC.plano_cliente,
  SC.plano_agrupado,
  SC.combinacao_produtos,
  SC.data_previsao_cancelamento
FROM LeadsPorMes LS
LEFT JOIN status_cliente SC ON LS.id_cliente = SC.id_cliente
WHERE
  LS.total_leads = 0
ORDER BY
  LS.mes,
  LS.nome_cliente`,

  // ---------------------------------------------------------------------------
  // Portfólio
  // ---------------------------------------------------------------------------

  // Chart: Imóveis publicados
  // Listing counts live on the agency record and are repeated on every site row (and shared by
  // agencies on the same base), so they are counted once per id_database.
  imoveis_publicados: `WITH por_base AS (
  SELECT
    id_database,
    MAX(imoveis_ativos_venda_ver_web) AS venda,
    MAX(imoveis_ativos_locacao_ver_web) AS locacao
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
  WHERE status_site IN ('ATIVO')
  GROUP BY id_database
)
SELECT
  SUM(venda) AS TOTAL_LISTINGS_VENDA,
  SUM(locacao) AS TOTAL_LISTINGS_LOCACAO,
  SUM(venda) + SUM(locacao) AS TOTAL_GERAL
FROM por_base`,

  // Chart: Imóveis vendidos pela imobiliária — total of the year
  vendidos_2026: `WITH ${VENDIDOS_IMOBILIARIA}
SELECT COUNT(*) AS quantidade_imoveis, SUM(valor_venda) AS valor_total_vendas
FROM vendidos`,

  // Chart: Imóveis vendidos — mês a mês
  vendidos_2026_mam: `WITH ${VENDIDOS_IMOBILIARIA}
SELECT
  DATE_TRUNC(data_venda, MONTH) AS mes_venda,
  COUNT(*) AS quantidade_imoveis,
  SUM(valor_venda) AS valor_total_vendas
FROM vendidos
GROUP BY mes_venda
ORDER BY mes_venda`,

  // Chart: Imóveis vendidos pela imobiliária — ranking. Agencies sharing one base (networks)
  // are one line, named after the first agency plus how many share it.
  vendidos_imob: `WITH ${VENDIDOS_IMOBILIARIA}
SELECT
  IF(b.qtd_imobiliarias > 1,
     CONCAT(b.primeira_imobiliaria, ' (rede de ', CAST(b.qtd_imobiliarias AS STRING), ' imobiliárias)'),
     b.primeira_imobiliaria) AS nome_cliente,
  COUNT(*) AS quantidade_imoveis,
  SUM(v.valor_venda) AS valor_total_vendas
FROM vendidos AS v
INNER JOIN bases_site AS b USING (id_database)
GROUP BY v.id_database, nome_cliente
ORDER BY quantidade_imoveis DESC
LIMIT 20`,

  // ---------------------------------------------------------------------------
  // Queries without a panel card
  // ---------------------------------------------------------------------------

  // Chart: Not used by a current chart
  // Kept so older metric ids still resolve.
  publicados_venda_2026: `SELECT
  SUM(imoveis_ativos_venda_ver_web) AS TOTAL_LISTINGS_VENDA,
  SUM(imoveis_ativos_locacao_ver_web) AS TOTAL_LISTINGS_LOCACAO,
  (SUM(imoveis_ativos_venda_ver_web) + SUM(imoveis_ativos_locacao_ver_web)) AS TOTAL_GERAL
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE
  status_site IN ('ATIVO')`,
  portal_sem: PORTAL_POR_IMOB + `SELECT
    id_cliente
    , nome_cliente
    , imoveis_no_site_total
    , imoveis_venda_no_site
    , imoveis_locacao_no_site
    , imoveis_portal_loft
FROM por_imobiliaria
WHERE imoveis_portal_loft = 0
ORDER BY imoveis_no_site_total DESC
LIMIT 20`,
  cms_sites_total: CMS_SITES_LATEST + `SELECT
  COUNT(DISTINCT newdata.domain) AS total_sites_cms,
  COUNT(DISTINCT CASE
    WHEN newdata.domain NOT LIKE '%preview%'
     AND newdata.domain NOT LIKE '%localhost%'
    THEN newdata.domain
  END) AS total_sites_oficiais,
  COUNT(DISTINCT CASE
    WHEN newdata.domain LIKE '%preview%'
    THEN newdata.domain
  END) AS total_sites_preview
FROM latest_per_brand
WHERE newdata IS NOT NULL
  AND newdata.deletedAt IS NULL
  AND newdata.domain IS NOT NULL`,
};
module.exports = { QUERIES };

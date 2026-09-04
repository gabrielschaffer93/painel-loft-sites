// Queries do BigQuery usadas pelo painel.
// Ficam no backend de proposito: o navegador nunca ve a credencial nem monta SQL.
// Para adicionar uma metrica: crie a chave aqui e use o mesmo id no METRIC_META do front.

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

const QUERIES = {
  subtotais: `WITH imobiliarias_sites AS (
    ${IMOBILIARIAS_SITES_DISTINCT}
)
SELECT
    COUNT(*) AS qtd_imobiliarias
    , SUM(qtd_venda_ver_web) AS total_imoveis_venda_no_site
    , SUM(qtd_locacao_ver_web) AS total_imoveis_locacao_no_site
    , SUM(qtd_venda_ver_web + qtd_locacao_ver_web) AS total_imoveis_no_site
FROM imobiliarias_sites`,
  novas_imob: `SELECT DATE_TRUNC(data_criacao, MONTH) AS mes_criacao, COUNT(id_database) AS total_sites_criados
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE data_criacao >= '2026-01-01'
GROUP BY mes_criacao
ORDER BY mes_criacao`,
  template: `SELECT template, COUNT(id_site_cms) AS total_imobs_por_template
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE status_site IN ('ATIVO') AND (template IS NOT NULL AND template != '')
GROUP BY template
ORDER BY total_imobs_por_template DESC`,
  pageviews: `SELECT COUNT(nome_evento) AS total_pageviews
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND data_ref BETWEEN "2026-01-01" AND CURRENT_DATE()`,
  pageviews_mes: `SELECT DATE_TRUNC(DATE(data_ref), MONTH) AS mes_referencia, COUNT(nome_evento) AS total_pageviews
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_referencia
ORDER BY mes_referencia`,
  views_busca: `SELECT COUNT(tipo_pagina) AS total_views_busca
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND tipo_pagina='busca' AND data_ref BETWEEN "2026-01-01" AND CURRENT_DATE()`,
  views_detalhe: `SELECT COUNT(tipo_pagina) AS total_views_detalhe
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'pageview' AND tipo_pagina='detalhe' AND data_ref BETWEEN "2026-01-01" AND CURRENT_DATE()`,
  views_composicao: `WITH metricas_views AS (
  SELECT
    DATE_TRUNC(DATE(data_ref), MONTH) AS mes_referencia,
    COUNTIF(tipo_pagina = 'busca') AS total_views_busca,
    COUNTIF(tipo_pagina = 'detalhe') AS total_views_imovel
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
  WHERE nome_evento = 'pageview'
    AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
  GROUP BY mes_referencia
),
metricas_crosssell AS (
  SELECT
    DATE_TRUNC(DATE(dt_evento), MONTH) AS mes_referencia,
    COUNT(nm_evento) AS total_crosssell
  FROM \`loft-dl-fintech.cp_bronze_stg.stg_loft_sites__gtm_eventos_analytics\`
  WHERE nm_evento LIKE '%cross%'
    AND DATE(dt_evento) BETWEEN '2026-01-01' AND CURRENT_DATE()
  GROUP BY mes_referencia
)
SELECT
  COALESCE(v.mes_referencia, c.mes_referencia) AS mes_referencia,
  COALESCE(v.total_views_busca, 0) AS total_views_busca,
  COALESCE(v.total_views_imovel, 0) AS total_views_imovel,
  COALESCE(c.total_crosssell, 0) AS total_crosssell
FROM metricas_views v
FULL OUTER JOIN metricas_crosssell c
  ON v.mes_referencia = c.mes_referencia
ORDER BY mes_referencia`,
  cross_sell: `SELECT
  COUNT(nm_evento) AS total_crosssell
FROM \`loft-dl-fintech.cp_bronze_stg.stg_loft_sites__gtm_eventos_analytics\`
WHERE nm_evento LIKE '%cross%'
  AND DATE(dt_evento) BETWEEN '2026-01-01' AND CURRENT_DATE()`,
  paginas_top: `SELECT caminho, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('pageview') AND caminho != '/' AND caminho NOT LIKE '/imovel/%' AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY caminho
ORDER BY total_eventos DESC
LIMIT 20`,
  total_leads: `SELECT COUNT(tipo_evento) AS total_leads
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN "2026-01-01" AND CURRENT_DATE()`,
  leads_mes: `SELECT DATE_TRUNC(data_ref, MONTH) AS mes_referencia, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY mes_referencia
ORDER BY mes_referencia`,
  leads_imob: `WITH imobiliarias_feature_ativa AS (
    SELECT DISTINCT
        clientes.id_cliente,
        clientes.id_database,
        clientes.nome_cliente AS nome_imobiliaria
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'
),
leads_cadastrados AS (
    SELECT
        a.id_imobiliaria,
        a.id_database,
        F.nome_imobiliaria,
        c.nome_cliente AS nome_lead
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__clientes\` AS c
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS a
        ON c.id_database = a.id_database
    INNER JOIN imobiliarias_feature_ativa AS F
        ON a.id_imobiliaria = F.id_cliente
    WHERE UPPER(c.veiculo_captacao) LIKE '%SITE IMOBILI%'
        AND c.data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER(PARTITION BY c.id_database, c.nome_cliente ORDER BY c.data_cadastro DESC) = 1
)
SELECT
    id_imobiliaria,
    id_database,
    nome_imobiliaria,
    COUNT(nome_lead) AS total_leads
FROM leads_cadastrados
GROUP BY
    id_imobiliaria,
    id_database,
    nome_imobiliaria
ORDER BY
    total_leads DESC`,
  leads_tipo: `SELECT nome_evento, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY nome_evento`,
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
  COUNT(DISTINCT nome_cliente) AS imobiliarias_sem_leads
FROM LeadsPorMes
WHERE
  total_leads = 0
GROUP BY
  mes
ORDER BY
  mes`,
  leads_crm: `WITH imobiliarias_feature_ativa AS (
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
leads_cadastrados AS (
    SELECT
        c.id_database,
        c.nome_cliente AS nome_lead,
        c.data_cadastro,
        c.veiculo_captacao
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__clientes\` AS c
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS a
        ON c.id_database = a.id_database
    INNER JOIN imobiliarias_feature_ativa AS f
        ON a.id_imobiliaria = f.id_cliente
        AND a.id_database = f.id_database
    WHERE c.veiculo_captacao LIKE 'SITE IMOBIL%'
      AND c.data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
)
SELECT
    COUNT(*) AS total_leads_crm
FROM leads_cadastrados`,
  leads_crm_mes: `WITH imobiliarias_feature_ativa AS (
    SELECT DISTINCT
        clientes.id_cliente,
        clientes.id_database,
        clientes.nome_cliente AS nome_imobiliaria
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features
        ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO'
        AND features.id_feature = 259
        AND features.status = 'ATIVO'
),
leads_cadastrados AS (
    SELECT
        c.nome_cliente AS nome_lead,
        DATE_TRUNC(DATE(c.data_cadastro), MONTH) AS mes_cadastro
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__clientes\` AS c
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS a
        ON c.id_database = a.id_database
    INNER JOIN imobiliarias_feature_ativa AS F
        ON a.id_imobiliaria = F.id_cliente
    WHERE UPPER(c.veiculo_captacao) LIKE '%SITE IMOBILI%'
        AND c.data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()
    QUALIFY ROW_NUMBER() OVER(PARTITION BY c.id_database, c.nome_cliente ORDER BY c.data_cadastro DESC) = 1
)
SELECT
    mes_cadastro,
    COUNT(nome_lead) AS total_leads
FROM leads_cadastrados
GROUP BY mes_cadastro
ORDER BY mes_cadastro`,
  top_sourcers: `SELECT origem_trafego, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento = 'pageview' AND origem_trafego != '' AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY origem_trafego
ORDER BY total_eventos DESC
LIMIT 20`,
  imoveis_publicados: `SELECT
  SUM(imoveis_ativos_venda_ver_web) AS TOTAL_LISTINGS_VENDA,
  SUM(imoveis_ativos_locacao_ver_web) AS TOTAL_LISTINGS_LOCACAO,
  (SUM(imoveis_ativos_venda_ver_web) + SUM(imoveis_ativos_locacao_ver_web)) AS TOTAL_GERAL
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE
  status_site IN ('ATIVO')`,
  publicados_venda_2026: `SELECT
  SUM(imoveis_ativos_venda_ver_web) AS TOTAL_LISTINGS_VENDA,
  SUM(imoveis_ativos_locacao_ver_web) AS TOTAL_LISTINGS_LOCACAO,
  (SUM(imoveis_ativos_venda_ver_web) + SUM(imoveis_ativos_locacao_ver_web)) AS TOTAL_GERAL
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE
  status_site IN ('ATIVO')`,
  vendidos_2026: `WITH imoveis_stage_dedup AS (
    SELECT id_database, id_imovel, data_atualizacao
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\`
    QUALIFY ROW_NUMBER() OVER(PARTITION BY id_database, id_imovel ORDER BY data_atualizacao DESC) = 1
)
SELECT COUNT(imoveis.id_imovel) AS quantidade_imoveis, SUM(imoveis.valor_venda) AS valor_total_vendas
FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
INNER JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS site ON site.id_cliente = clientes.id_cliente
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.portfolio_imoveis\` AS imoveis ON imoveis.id_database = site.id_database
LEFT JOIN imoveis_stage_dedup AS STAGE ON CAST(imoveis.id_database AS STRING) = CAST(STAGE.id_database AS STRING) AND CAST(imoveis.id_imovel AS STRING) = CAST(STAGE.id_imovel AS STRING)
WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
  AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR'
  AND STAGE.data_atualizacao >= '2026-01-01' AND DATE(STAGE.data_atualizacao) <= CURRENT_DATE()
  AND imoveis.status_imovel NOT IN ('VENDIDO CONCORRÊNCIA','VENDIDO DIRETO','VENDIDA POR TERCEIRO','VENDIDO TECEIROS','VENDIDO TERCEIROS0','VENDIDO TERCEIROS','VENDIDO OUTROS','VENDIDO PELO PROPRIETARIO','VENDIDO CONSTRUTORA','VENDIDO P/ PROPRIETARIO','VENDIDO OUTRA IMOBIL','VENDIDO PARCEIROS','VENDIDO PROPRIETÁRIO','VENDIDO P/ PROPRIETA','VENDIDO PELO PROP.','VENDIDA TERCEIRO','VENDIDO PELO PROPRIETÁRIO','VENDIDO PARTICULAR','VENDIDO TERCEIROS -','VENDIDO PELO PROPRIE')`,
  vendidos_2026_mam: `WITH imoveis_stage_dedup AS (
    SELECT id_database, id_imovel, data_atualizacao
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\`
    QUALIFY ROW_NUMBER() OVER(PARTITION BY id_database, id_imovel ORDER BY data_atualizacao DESC) = 1
)
SELECT DATE_TRUNC(DATE(STAGE.data_atualizacao), MONTH) AS mes_venda,
  COUNT(imoveis.id_imovel) AS quantidade_imoveis, SUM(imoveis.valor_venda) AS valor_total_vendas
FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
INNER JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS site ON site.id_cliente = clientes.id_cliente
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.portfolio_imoveis\` AS imoveis ON imoveis.id_database = site.id_database
LEFT JOIN imoveis_stage_dedup AS STAGE ON CAST(imoveis.id_database AS STRING) = CAST(STAGE.id_database AS STRING) AND CAST(imoveis.id_imovel AS STRING) = CAST(STAGE.id_imovel AS STRING)
WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
  AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR'
  AND STAGE.data_atualizacao >= '2026-01-01' AND DATE(STAGE.data_atualizacao) <= CURRENT_DATE()
  AND imoveis.status_imovel NOT IN ('VENDIDO CONCORRÊNCIA','VENDIDO DIRETO','VENDIDA POR TERCEIRO','VENDIDO TECEIROS','VENDIDO TERCEIROS0','VENDIDO TERCEIROS','VENDIDO OUTROS','VENDIDO PELO PROPRIETARIO','VENDIDO CONSTRUTORA','VENDIDO P/ PROPRIETARIO','VENDIDO OUTRA IMOBIL','VENDIDO PARCEIROS','VENDIDO PROPRIETÁRIO','VENDIDO P/ PROPRIETA','VENDIDO PELO PROP.','VENDIDA TERCEIRO','VENDIDO PELO PROPRIETÁRIO','VENDIDO PARTICULAR','VENDIDO TERCEIROS -','VENDIDO PELO PROPRIE')
GROUP BY mes_venda
ORDER BY mes_venda`,
  vendidos_imob: `WITH imoveis_stage_dedup AS (
    SELECT id_database, id_imovel, data_atualizacao
    FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\`
    QUALIFY ROW_NUMBER() OVER(PARTITION BY id_database, id_imovel ORDER BY data_atualizacao DESC) = 1
)
SELECT clientes.nome_cliente,
  COUNT(imoveis.id_imovel) AS quantidade_imoveis, SUM(imoveis.valor_venda) AS valor_total_vendas
FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
INNER JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS site ON site.id_cliente = clientes.id_cliente
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.portfolio_imoveis\` AS imoveis ON imoveis.id_database = site.id_database
LEFT JOIN imoveis_stage_dedup AS STAGE ON CAST(imoveis.id_database AS STRING) = CAST(STAGE.id_database AS STRING) AND CAST(imoveis.id_imovel AS STRING) = CAST(STAGE.id_imovel AS STRING)
WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
  AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR'
  AND STAGE.data_atualizacao >= '2026-01-01' AND DATE(STAGE.data_atualizacao) <= CURRENT_DATE()
  AND imoveis.status_imovel NOT IN ('VENDIDO CONCORRÊNCIA','VENDIDO DIRETO','VENDIDA POR TERCEIRO','VENDIDO TECEIROS','VENDIDO TERCEIROS0','VENDIDO TERCEIROS','VENDIDO OUTROS','VENDIDO PELO PROPRIETARIO','VENDIDO CONSTRUTORA','VENDIDO P/ PROPRIETARIO','VENDIDO OUTRA IMOBIL','VENDIDO PARCEIROS','VENDIDO PROPRIETÁRIO','VENDIDO P/ PROPRIETA','VENDIDO PELO PROP.','VENDIDA TERCEIRO','VENDIDO PELO PROPRIETÁRIO','VENDIDO PARTICULAR','VENDIDO TERCEIROS -','VENDIDO PELO PROPRIE')
GROUP BY clientes.nome_cliente
ORDER BY quantidade_imoveis DESC
LIMIT 20`,
  publicados_vendidos_mes: `WITH publicados_mes AS (
  SELECT DATE_TRUNC(DATE(data_criacao), MONTH) AS mes_referencia, SUM(imoveis_ativos_venda_ver_web) AS total_publicados
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
  WHERE status_site = 'ATIVO' AND data_criacao >= '2026-01-01' AND DATE(data_criacao) <= CURRENT_DATE()
  GROUP BY 1
), imoveis_stage_dedup AS (
  SELECT id_database, id_imovel, data_atualizacao
  FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\`
  QUALIFY ROW_NUMBER() OVER(PARTITION BY id_database, id_imovel ORDER BY data_atualizacao DESC) = 1
), vendidos_mes AS (
  SELECT DATE_TRUNC(DATE(STAGE.data_atualizacao), MONTH) AS mes_referencia,
    COUNT(imoveis.id_imovel) AS total_vendidos, SUM(imoveis.valor_venda) AS valor_total_vendas
  FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
  INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
  INNER JOIN \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS site ON site.id_cliente = clientes.id_cliente
  LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.portfolio_imoveis\` AS imoveis ON imoveis.id_database = site.id_database
  LEFT JOIN imoveis_stage_dedup AS STAGE ON CAST(imoveis.id_database AS STRING) = CAST(STAGE.id_database AS STRING) AND CAST(imoveis.id_imovel AS STRING) = CAST(STAGE.id_imovel AS STRING)
  WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
    AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR'
    AND STAGE.data_atualizacao >= '2026-01-01' AND DATE(STAGE.data_atualizacao) <= CURRENT_DATE()
    AND imoveis.status_imovel NOT IN ('VENDIDO CONCORRÊNCIA','VENDIDO DIRETO','VENDIDA POR TERCEIRO','VENDIDO TECEIROS','VENDIDO TERCEIROS0','VENDIDO TERCEIROS','VENDIDO OUTROS','VENDIDO PELO PROPRIETARIO','VENDIDO CONSTRUTORA','VENDIDO P/ PROPRIETARIO','VENDIDO OUTRA IMOBIL','VENDIDO PARCEIROS','VENDIDO PROPRIETÁRIO','VENDIDO P/ PROPRIETA','VENDIDO PELO PROP.','VENDIDA TERCEIRO','VENDIDO PELO PROPRIETÁRIO','VENDIDO PARTICULAR','VENDIDO TERCEIROS -','VENDIDO PELO PROPRIE')
  GROUP BY 1
)
SELECT COALESCE(p.mes_referencia, v.mes_referencia) AS mes_referencia,
  IFNULL(p.total_publicados, 0) AS total_publicados, IFNULL(v.total_vendidos, 0) AS total_vendidos, IFNULL(v.valor_total_vendas, 0) AS valor_total_vendas
FROM publicados_mes AS p
FULL OUTER JOIN vendidos_mes AS v ON p.mes_referencia = v.mes_referencia
ORDER BY mes_referencia`,
  total_acessos: `SELECT COUNT(EVE.id_usuario) AS soma_total_usuarios
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS IMO
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.eventos_gtm\` AS EVE ON IMO.hostname = EVE.hostname
WHERE EVE.data_ref >= '2026-01-01'`,
  usuarios_mes: `SELECT DATE_TRUNC(EVE.data_ref, MONTH) AS mes, COUNT(DISTINCT EVE.id_usuario) AS total_usuarios_unicos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS IMO
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.eventos_gtm\` AS EVE ON IMO.hostname = EVE.hostname
WHERE EVE.data_ref >= '2026-01-01' AND EVE.data_ref <= CURRENT_DATE()
GROUP BY mes
ORDER BY mes`,
  usuarios_total: `SELECT COUNT(DISTINCT EVE.id_usuario) AS total_usuarios_unicos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS IMO
LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.eventos_gtm\` AS EVE ON IMO.hostname = EVE.hostname
WHERE EVE.data_ref >= '2026-01-01' AND EVE.data_ref <= CURRENT_DATE()`,
  usuarios_media_dia: `SELECT AVG(usuarios_dia) AS media_usuarios_dia
FROM (
  SELECT DATE(EVE.data_ref) AS dia, COUNT(DISTINCT EVE.id_usuario) AS usuarios_dia
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\` AS IMO
  LEFT JOIN \`loft-dl-marketplace.silver_loft_sites.eventos_gtm\` AS EVE ON IMO.hostname = EVE.hostname
  WHERE EVE.data_ref >= '2026-01-01' AND EVE.data_ref <= CURRENT_DATE()
  GROUP BY dia
)`,
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
  portal_com_count: PORTAL_POR_IMOB + `SELECT COUNT(*) AS total_imobiliarias_no_portal
FROM por_imobiliaria
WHERE imoveis_portal_loft > 0`,
  portal_cobertura: PORTAL_POR_IMOB + `SELECT
    (SELECT COUNT(*) FROM (${IMOBILIARIAS_SITES_DISTINCT})) AS total_imobiliarias_base
    , COUNTIF(imoveis_portal_loft > 0) AS total_imobiliarias_portal
    , SUM(imoveis_no_site_total) AS total_imoveis_base
    , SUM(imoveis_portal_loft) AS total_imoveis_portal
FROM por_imobiliaria`,
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
  cms_multi_sites: CMS_SITES_LATEST + `SELECT
  COUNT(*) AS total_imobiliarias_multi_site,
  SUM(quantidade_sites_oficiais) AS total_sites_multi
FROM (
  SELECT
    loftClientCode,
    COUNT(DISTINCT CASE
      WHEN newdata.domain NOT LIKE '%preview%'
       AND newdata.domain NOT LIKE '%localhost%'
      THEN newdata.domain
    END) AS quantidade_sites_oficiais
  FROM latest_per_brand
  WHERE newdata IS NOT NULL
    AND newdata.deletedAt IS NULL
    AND newdata.domain IS NOT NULL
    AND loftClientCode IS NOT NULL
  GROUP BY loftClientCode
  HAVING COUNT(DISTINCT CASE
      WHEN newdata.domain NOT LIKE '%preview%'
       AND newdata.domain NOT LIKE '%localhost%'
      THEN newdata.domain
    END) > 1
)`
};

module.exports = { QUERIES };

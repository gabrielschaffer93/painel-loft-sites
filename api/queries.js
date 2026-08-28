// Queries do BigQuery usadas pelo painel.
// Ficam no backend de proposito: o navegador nunca ve a credencial nem monta SQL.
// Para adicionar uma metrica: crie a chave aqui e use o mesmo id no METRIC_META do front.

const QUERIES = {
  subtotais: `SELECT
    COUNT(DISTINCT clientes.id_cliente) AS imobiliarias_feature_259_ativas
  , SUM(COALESCE(clientes.imoveis_ativos_venda_ver_web, 0)) AS listings_venda_ver_web
  , SUM(COALESCE(clientes.imoveis_ativos_locacao_ver_web, 0)) AS listings_locacao_ver_web
  , SUM(COALESCE(clientes.imoveis_ativos_venda_ver_web, 0) + COALESCE(clientes.imoveis_ativos_locacao_ver_web, 0)) AS listings_ver_web_soma
FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'`,
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
  cross_sell: `SELECT
  COUNT(nome_evento) AS total_cross_sell
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE nome_evento = 'CrossSell'
  AND data_ref BETWEEN DATE '2026-01-01' AND CURRENT_DATE()`,
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
  leads_imob: `SELECT nome_cliente, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND (nome_cliente IS NOT NULL AND nome_cliente != '') AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY nome_cliente
ORDER BY total_eventos DESC
LIMIT 10`,
  leads_tipo: `SELECT nome_evento, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato')
  AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY nome_evento`,
  imob_sem_leads: `SELECT nome_cliente,
  COUNT(CASE WHEN tipo_evento IN ('contato whatsapp', 'form lead imóvel', 'ligar', 'agendar visita', 'email', 'form de contato') THEN 1 END) AS total_leads
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE (nome_cliente IS NOT NULL AND nome_cliente != '') AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY nome_cliente
HAVING total_leads = 0`,
  leads_crm: `WITH imobiliarias_feature_ativa AS (
    SELECT DISTINCT clientes.id_cliente
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
)
SELECT COUNT(*) AS total_leads_crm
FROM \`loft-dl-marketplace.staging.stg_union_all_crm_daily__clientes\` AS c
LEFT JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS a ON c.id_database = a.id_database
WHERE a.id_imobiliaria IN (SELECT id_cliente FROM imobiliarias_feature_ativa)
  AND c.veiculo_captacao LIKE "%SITE IMOBILI%" AND c.data_cadastro BETWEEN '2026-01-01' AND CURRENT_DATE()`,
  top_sourcers: `SELECT origem_trafego, COUNT(tipo_evento) AS total_eventos
FROM \`loft-dl-marketplace.gold_loft_sites.sites_eventos_gtm\`
WHERE tipo_evento = 'pageview' AND origem_trafego != '' AND data_ref BETWEEN '2026-01-01' AND CURRENT_DATE()
GROUP BY origem_trafego
ORDER BY total_eventos DESC
LIMIT 20`,
  imoveis_publicados: `SELECT SUM(imoveis_ativos_venda_ver_web) AS TOTAL_LISTINGS_VENDA, SUM(imoveis_ativos_locacao_ver_web) AS TOTAL_LISTINGS_LOCACAO,
  (SUM(imoveis_ativos_venda_ver_web) + SUM(imoveis_ativos_locacao_ver_web)) AS TOTAL_GERAL
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE status_site IN ('ATIVO')`,
  publicados_venda_2026: `SELECT SUM(imoveis_ativos_venda_ver_web) AS TOTAL_LISTINGS_VENDA
FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
WHERE status_site IN ('ATIVO') AND data_criacao >= '2026-01-01'`,
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
  AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR' AND STAGE.data_atualizacao >= '2026-01-01'
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
  AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR' AND STAGE.data_atualizacao >= '2026-01-01'
  AND imoveis.status_imovel NOT IN ('VENDIDO CONCORRÊNCIA','VENDIDO DIRETO','VENDIDA POR TERCEIRO','VENDIDO TECEIROS','VENDIDO TERCEIROS0','VENDIDO TERCEIROS','VENDIDO OUTROS','VENDIDO PELO PROPRIETARIO','VENDIDO CONSTRUTORA','VENDIDO P/ PROPRIETARIO','VENDIDO OUTRA IMOBIL','VENDIDO PARCEIROS','VENDIDO PROPRIETÁRIO','VENDIDO P/ PROPRIETA','VENDIDO PELO PROP.','VENDIDA TERCEIRO','VENDIDO PELO PROPRIETÁRIO','VENDIDO PARTICULAR','VENDIDO TERCEIROS -','VENDIDO PELO PROPRIE')
GROUP BY mes_venda
ORDER BY mes_venda`,
  publicados_vendidos_mes: `WITH publicados_mes AS (
  SELECT DATE_TRUNC(DATE(data_criacao), MONTH) AS mes_referencia, SUM(imoveis_ativos_venda_ver_web) AS total_publicados
  FROM \`loft-dl-marketplace.gold_loft_sites.sites_imobiliarias\`
  WHERE status_site = 'ATIVO' AND data_criacao >= '2026-01-01'
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
    AND imoveis.flag_vendido IS TRUE AND imoveis.status_exibicao = 'EXIBIR' AND STAGE.data_atualizacao >= '2026-01-01'
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
  portal_com: `WITH imobiliarias_sites AS (
    SELECT DISTINCT clientes.id_cliente, clientes.nome_cliente
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
), imoveis_no_site AS (
    SELECT DISTINCT imobiliarias_sites.id_cliente, imobiliarias_sites.nome_cliente, CAST(imoveis.id_imovel AS STRING) AS id_imovel
    FROM imobiliarias_sites
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS agencias ON imobiliarias_sites.id_cliente = agencias.id_imobiliaria
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\` AS imoveis ON agencias.id_database = imoveis.id_database AND agencias.id_agencia = imoveis.id_agencia
    WHERE imoveis.exibir_site IS TRUE AND NOT STARTS_WITH(UPPER(TRIM(imoveis.status)), 'VENDID')
), anuncios_portal AS (
    SELECT DISTINCT portal.id_imovel_vista, portal.listing_id
    FROM \`loft-dl-marketplace.gold_supply.listings\` AS portal
    WHERE portal.id_imovel_vista IS NOT NULL AND portal.current_status LIKE '%FOR_SALE%'
), imoveis_com_flag AS (
    SELECT imoveis_no_site.id_cliente, imoveis_no_site.nome_cliente, imoveis_no_site.id_imovel, anuncios_portal.listing_id IS NOT NULL AS esta_no_portal_loft
    FROM imoveis_no_site
    LEFT JOIN anuncios_portal ON imoveis_no_site.id_imovel = anuncios_portal.id_imovel_vista
), resumo_imobiliaria AS (
    SELECT id_cliente, nome_cliente, COUNT(DISTINCT id_imovel) AS qtd_imoveis_no_site,
        COUNTIF(esta_no_portal_loft) AS qtd_imoveis_tambem_no_portal, COUNTIF(NOT esta_no_portal_loft) AS qtd_imoveis_so_no_site,
        COUNTIF(esta_no_portal_loft) > 0 AS tem_algum_imovel_no_portal
    FROM imoveis_com_flag
    GROUP BY id_cliente, nome_cliente
)
SELECT id_cliente, nome_cliente, tem_algum_imovel_no_portal, qtd_imoveis_no_site, qtd_imoveis_tambem_no_portal, qtd_imoveis_so_no_site
FROM resumo_imobiliaria
WHERE tem_algum_imovel_no_portal = TRUE
ORDER BY qtd_imoveis_no_site DESC
LIMIT 20`,
  portal_com_count: `WITH imobiliarias_sites AS (
    SELECT DISTINCT clientes.id_cliente, clientes.nome_cliente
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
), imoveis_no_site AS (
    SELECT DISTINCT imobiliarias_sites.id_cliente, imobiliarias_sites.nome_cliente, CAST(imoveis.id_imovel AS STRING) AS id_imovel
    FROM imobiliarias_sites
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS agencias ON imobiliarias_sites.id_cliente = agencias.id_imobiliaria
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\` AS imoveis ON agencias.id_database = imoveis.id_database AND agencias.id_agencia = imoveis.id_agencia
    WHERE imoveis.exibir_site IS TRUE AND NOT STARTS_WITH(UPPER(TRIM(imoveis.status)), 'VENDID')
), anuncios_portal AS (
    SELECT DISTINCT portal.id_imovel_vista, portal.listing_id
    FROM \`loft-dl-marketplace.gold_supply.listings\` AS portal
    WHERE portal.id_imovel_vista IS NOT NULL AND portal.current_status LIKE '%FOR_SALE%'
), imoveis_com_flag AS (
    SELECT imoveis_no_site.id_cliente, anuncios_portal.listing_id IS NOT NULL AS esta_no_portal_loft
    FROM imoveis_no_site
    LEFT JOIN anuncios_portal ON imoveis_no_site.id_imovel = anuncios_portal.id_imovel_vista
), resumo_imobiliaria AS (
    SELECT id_cliente, COUNTIF(esta_no_portal_loft) > 0 AS tem_algum_imovel_no_portal
    FROM imoveis_com_flag
    GROUP BY id_cliente
)
SELECT COUNT(*) AS total_imobiliarias_no_portal
FROM resumo_imobiliaria
WHERE tem_algum_imovel_no_portal = TRUE`,
  portal_sem: `WITH imobiliarias_sites AS (
    SELECT DISTINCT clientes.id_cliente, clientes.nome_cliente
    FROM \`loft-dl-marketplace.silver_product_vista.clientes\` AS clientes
    INNER JOIN \`loft-dl-marketplace.silver_product_vista.clientes_features\` AS features ON clientes.id_cliente = features.id_cliente
    WHERE clientes.status = 'ATIVO' AND features.id_feature = 259 AND features.status = 'ATIVO'
), imoveis_no_site AS (
    SELECT DISTINCT imobiliarias_sites.id_cliente, imobiliarias_sites.nome_cliente, CAST(imoveis.id_imovel AS STRING) AS id_imovel
    FROM imobiliarias_sites
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__agencias\` AS agencias ON imobiliarias_sites.id_cliente = agencias.id_imobiliaria
    INNER JOIN \`loft-dl-marketplace.staging.stg_union_all_crm_daily__imoveis\` AS imoveis ON agencias.id_database = imoveis.id_database AND agencias.id_agencia = imoveis.id_agencia
    WHERE imoveis.exibir_site IS TRUE AND NOT STARTS_WITH(UPPER(TRIM(imoveis.status)), 'VENDID')
), anuncios_portal AS (
    SELECT DISTINCT portal.id_imovel_vista, portal.listing_id
    FROM \`loft-dl-marketplace.gold_supply.listings\` AS portal
    WHERE portal.id_imovel_vista IS NOT NULL AND portal.current_status LIKE '%FOR_SALE%'
), imoveis_com_flag AS (
    SELECT imoveis_no_site.id_cliente, imoveis_no_site.nome_cliente, imoveis_no_site.id_imovel, anuncios_portal.listing_id IS NOT NULL AS esta_no_portal_loft
    FROM imoveis_no_site
    LEFT JOIN anuncios_portal ON imoveis_no_site.id_imovel = anuncios_portal.id_imovel_vista
), resumo_imobiliaria AS (
    SELECT id_cliente, nome_cliente, COUNT(DISTINCT id_imovel) AS qtd_imoveis_no_site,
        COUNTIF(esta_no_portal_loft) AS qtd_imoveis_tambem_no_portal, COUNTIF(NOT esta_no_portal_loft) AS qtd_imoveis_so_no_site,
        COUNTIF(esta_no_portal_loft) > 0 AS tem_algum_imovel_no_portal
    FROM imoveis_com_flag
    GROUP BY id_cliente, nome_cliente
)
SELECT id_cliente, nome_cliente, tem_algum_imovel_no_portal, qtd_imoveis_no_site, qtd_imoveis_tambem_no_portal, qtd_imoveis_so_no_site
FROM resumo_imobiliaria
WHERE tem_algum_imovel_no_portal = FALSE
ORDER BY qtd_imoveis_no_site DESC
LIMIT 20`,
};

module.exports = { QUERIES };
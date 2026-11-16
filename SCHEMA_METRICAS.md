# Metric schema

The dashboard reads BigQuery only. Each card calls `GET /api/bigquery?metric=<id>`. The SQL lives in `api/queries.js`. The browser never sends SQL.

## Broker page funnel (`corretor_funil`)

Source table: `loft-dl-marketplace.bronze_gtm_capital.gtm_eventos_analytics`.

Partition column `_PARTITIONTIME` is always filtered. Preview hosts (`hostname LIKE '%loftpreview.com.br'`) are excluded.

Parameters (BigQuery query parameters, not string concatenation):

| Parameter | Values | Default |
| --- | --- | --- |
| `@dias` | 7, 30 or 90 | 90 |
| `@hostname` | lowercase hostname, or empty for every site | empty |

Window: `DATE_SUB(CURRENT_DATE('America/Sao_Paulo'), INTERVAL @dias DAY)` through today.

### Steps (one session, timestamp order)

1. Sessions with a `pageview` whose `pathname` starts with `/corretor/`. The listing `/corretores` is not included.
2. Of those, sessions with a `pageview` on `/imovel/` whose timestamp is after the first broker pageview.
3. Of those, sessions with a contact event whose timestamp is after the property pageview.

### Contact event

`LOWER(name)` matches `whatsapp`, `ligar`, `email`, `form` or `agendar`, and does not match `aberto`, `iniciado` or `abandonado`.

Checked against the last 7 days of event names (28 Oct 2026):

| Event | In the contact filter |
| --- | --- |
| pageview | no |
| Contato WhatsApp | yes |
| Form Lead Imóvel | yes |
| Ligar | yes |
| Agendar Visita | yes |
| Email | yes |
| CrossSell | no |
| Form de Contato | yes |
| Form WhatsApp Aberto | no (intermediate) |
| Anuncie | no |
| Form WhatsApp Abandonado | no (intermediate) |
| Form WhatsApp Iniciado | no (intermediate) |
| Form WhatsApp Enviado | yes (form was sent) |

### Extra metric

Direct contact: a contact event on `/corretor/`, at or after the first broker pageview of that session. It does not require the property step.

### Bytes processed (US, 28 Oct 2026)

| Run | Bytes |
| --- | --- |
| Event-name list, 7 days | 0.05 GB (52,609,714) |
| Funnel total, 7 days | 0.13 GB (130,301,532) |
| Funnel total, 90 days | 1.45 GB (1,448,172,387) |

The panel cache keeps the default 90-day result until the next explicit refresh, so a page view does not scan the bronze table again. Other period and hostname combinations are cached under their own key.

### 90-day check against the manual silver reference

Reference: about 3,000 sessions in step 1 and about 39% reaching a property, without timestamp order.

This query, with timestamp order: 3,119 sessions in step 1 and 35.7% reaching a property. Step 1 is the same magnitude. Steps 2 and 3 are lower because a later hit only counts when it happens after the previous step.

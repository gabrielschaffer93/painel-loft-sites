# Painel de Dashboard — Loft Sites

OKR dashboard for the Sites product (GTM Capital). Metrics come from BigQuery.

## Structure

```
painel-sites-loft/
├── api/
│   ├── auth-config.js  # exposes the Google OAuth client id to the frontend
│   ├── bigquery.js     # serverless function: runs the queries in BigQuery
│   └── queries.js      # the 25 SQL queries (server-side only)
├── public/
│   └── index.html      # the full panel (single HTML/CSS/JS file)
├── package.json
├── vercel.json
└── README.md
```

The browser never sends SQL. It only calls `/api/bigquery?metric=total_leads`
with the user's Google access token. The server picks the query.

## Auth: Google OAuth consent screen (no service account)

Queries run as the signed-in Google user. You still need an **OAuth 2.0 Client ID**
in an existing GCP project — not a service account and not a JSON key.

### 1. OAuth consent screen

In the GCP project you already use (for example `loft-data-llm-workloads`):

1. APIs & Services → enable **BigQuery API**
2. APIs & Services → **OAuth consent screen**
3. User type: **External** (the allowlist includes `@loft.com.br` and `@vistasoft.com.br`)
4. App name: `Painel Sites Loft`
5. Scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/bigquery`
6. While the app is in **Testing**, add the allowlist emails as test users

Your Google user must already have BigQuery access (`bigquery.jobUser` on the
billing project and `bigquery.dataViewer` on `loft-dl-marketplace` / `loft-dl-fintech`).

### 2. OAuth client ID

1. APIs & Services → Credentials → Create credentials → **OAuth client ID**
2. Application type: **Web application**
3. Authorized JavaScript origins:
   - `http://localhost:3000`
   - your Vercel URL, when you deploy
4. Authorized redirect URIs: the same origins
5. Copy the client id (`....apps.googleusercontent.com`)

### 3. Environment variables

Create `.env.local` next to `package.json`:

```
GOOGLE_OAUTH_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
BQ_BILLING_PROJECT=loft-data-llm-workloads
CACHE_TTL_MINUTES=60
ALLOWED_EMAILS=gabriel.oliveira@vistasoft.com.br,elias.bernardi@loft.com.br,bruno.bertozzo@loft.com.br,luiza.pais@loft.com.br
```

On Vercel, set the same variables in Project Settings → Environment Variables.

Optional: `GCP_SERVICE_ACCOUNT_KEY` is still accepted as a fallback. It is not required.

### 4. Run locally

```bash
npm install
npx vercel dev
```

Open `http://localhost:3000`, click **Entrar com Google**, and accept BigQuery
access on the consent screen.

Local alternative without the in-app OAuth client: run
`gcloud auth application-default login` once. The API then uses Application
Default Credentials if the browser does not send a token.

### 5. Deploy

```bash
npx vercel --prod
```

Or connect the repository in the Vercel dashboard.

## Access control

The panel keeps an email allowlist in `public/index.html` (`ALLOWED_EMAILS`)
and the same list in `ALLOWED_EMAILS` on the server.

The frontend list is only a casual gate. The real controls are:

- Google OAuth token required to run queries
- IAM permissions of that Google user on BigQuery
- Optional server-side `ALLOWED_EMAILS`

JumpCloud SSO code is still in `index.html` (`JC_CLIENT_ID`) if you need it later.

## BigQuery quota

Queries against `sites_eventos_gtm` are heavy (~1 GB each). Several people
clicking "Atualizar tudo" can burn the daily quota.

Mitigations already in the code:

- **1-hour cache** per metric (`CACHE_TTL_MINUTES`)
- Sequential queries (one at a time), not in parallel

If that is still not enough, consider a daily cron that materializes the data
instead of leaving the refresh button open for everyone.

## Add a new metric

1. Add the query in `api/queries.js` with a new key
2. In `public/index.html`, add the same key to `METRIC_META`
3. Use the key on the matching card

The metric `id` must be **identical** in both files.

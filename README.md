# Painel de Dashboard — Loft Sites

OKR dashboard for the Sites product (GTM Capital). Metrics come from BigQuery.

## Structure

```
painel-sites-loft/
├── api/
│   ├── auth-config.js  # public client id + allowlist for the login screen
│   ├── bigquery.js     # runs the queries in BigQuery
│   └── queries.js      # the SQL queries (server-side only)
├── lib/
│   ├── config.js       # the only file you edit to set up the app
│   └── cache.js
├── public/
│   └── index.html
├── package.json
└── server.js
```

The browser never sends SQL. It only calls `/api/bigquery?metric=total_leads`
with the user's Google access token. The server picks the query.

No environment variables are required. Do not create a `.env` for this project.

## Setup (once, then the whole team can run)

### 1. Paste the Google OAuth client id

Open `lib/config.js` and set `googleClientId`. That value is public (Web client
id, not a secret). After it is in the repo, every teammate can sign in.

If the client does not exist yet, in any GCP project the team already uses:

1. Enable the **BigQuery API**
2. **OAuth consent screen** (External, because the list has `@loft.com.br` and `@vistasoft.com.br`)
3. Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/bigquery`
4. While the app is in **Testing**, add the allowlist emails as test users
5. Credentials → **OAuth client ID** → **Web application**
6. Authorized JavaScript origins (and redirect URIs):
   - `http://localhost:3000`
   - the Vercel URL, when you deploy

### 2. Who can open the panel

The allowlist lives in `lib/config.js` (`allowedEmails`). Add or remove emails there.

Each Google user also needs BigQuery IAM:

- `bigquery.jobUser` on `loft-dl-marketplace` (jobs are billed in the same project as the tables)
- `bigquery.dataViewer` on `loft-dl-marketplace` and `loft-dl-fintech`

### 3. Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` and click **Entrar com Google**. Accept BigQuery
access on the consent screen.

Local alternative without the in-app Google client: run
`gcloud auth application-default login` once. The API then uses Application
Default Credentials if the browser does not send a token.

### 4. Deploy

```bash
npx vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard. There is nothing to set in
**Environment Variables**.

Add the Vercel URL to the OAuth client's authorized origins.

If the consent screen is still in **Testing**, add every teammate as a test user.

Email-only login still opens the UI, but on Vercel the API requires a Google
token. Use **Entrar com Google** in production.

After one successful **Atualizar tudo**, other signed-in users can load the
shared snapshot from the API instead of an empty `localStorage`.

## Access control

- Allowlist in `lib/config.js` (login screen and API)
- Google OAuth token required to run queries on Vercel
- IAM permissions of that Google user on BigQuery

## BigQuery quota

Queries against `sites_eventos_gtm` are heavy (~1 GB each). Several people
clicking "Atualizar tudo" can burn the daily quota.

Mitigations already in the code:

- Last query results stay until someone clicks **Atualizar tudo**
- Sequential queries (one at a time), not in parallel

## Add a new metric

1. Add the query in `api/queries.js` with a new key
2. In `public/index.html`, add the same key to `METRIC_META`
3. Use the key on the matching card

The metric `id` must be **identical** in both files.

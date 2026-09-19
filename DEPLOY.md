# Deploying ResearchGPT

ResearchGPT deploys as two containers plus a Postgres database. Users bring
their own LLM key, and **the server never holds one**.

```
browser ──HTTPS──▶ frontend (nginx: static app + security headers)
                      │  /api/*  (same origin, so cookies and CSP just work)
                      ▼
                   backend (FastAPI) ──▶ Postgres
browser ──HTTPS──▶ generativelanguage.googleapis.com   (user's key, direct)
```

Both images are production-ready:
- **Backend:** multi-stage build, non-root user, JSON logs.
- **Frontend:** nginx serving the built app, with the API address set at start-up.

This setup has been verified locally as a production-like stack (see
[Verify](#5-verify)). It has **not** been deployed to any specific hosting
platform yet, so adapt the platform steps below to your provider.

---

## 1. Database

Any Postgres 15+ works (Neon, Supabase, RDS, or a managed instance on your platform).

- `DATABASE_URL`: `postgresql+asyncpg://USER:PASS@HOST/DB`. Neon and Supabase hosts, and `?sslmode=require`, get TLS automatically.
- `SYNC_DATABASE_URL`: the same, as `postgresql://USER:PASS@HOST/DB` (used by migrations).

## 2. Backend container (`backend/Dockerfile`)

**Release step** (run once per deploy, before new instances start):

```sh
alembic upgrade head
```

Most platforms have a "release" or "pre-deploy" command for this. With Compose, the `migrate` service does it.

**Environment:**

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `SECRET_KEY` | `openssl rand -hex 32`. The API refuses to start if it's weak. |
| `COOKIE_SECURE` | `true` (required outside development) |
| `DATABASE_URL`, `SYNC_DATABASE_URL` | see above |
| `CORS_ORIGINS` | `["https://your-domain"]` |
| `FORWARDED_ALLOW_IPS` | IP or CIDR of your reverse proxy, so rate limits see real client IPs. Never `*` if the API port is reachable from the internet. |
| `RATE_LIMIT_STORAGE_URI` | `memory://` (per instance) or `redis://…` to share limits across instances |
| `SENTRY_DSN` | optional; events are scrubbed of cookies, auth headers and bodies |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, … | **must not be set**; the API refuses to start if they are |

**Other settings:**
- Port: `8000`. Health check: `GET /health`, which returns 503 when the database is unreachable.
- Keep the backend private if your platform allows it. Only the frontend container needs to reach it.

## 3. Frontend container (`frontend/Dockerfile`)

| Variable | Value |
|---|---|
| `API_UPSTREAM` | the backend's internal URL, e.g. `http://backend.internal:8000` (default `http://backend:8000`) |

It listens on port `80` and serves:
- the app, with the CSP and other headers from `frontend/nginx.conf.template`
- `/api/*`, proxied to `API_UPSTREAM`

Terminate TLS in front of it (every platform does this for you).

> **Static host instead of a container?** `frontend/public/_headers` carries the
> same headers for Cloudflare Pages or Netlify. The host must **proxy** `/api/*`
> to the backend on the same origin; a redirect isn't enough, because cookies
> and the CSP rely on one origin. Netlify can do this in `_redirects`, e.g.
> `/api/*  https://api.example.com/api/:splat  200`.

## 4. Adding another LLM provider later

Browser calls to a provider must be allowed by the CSP. Add the provider's API
host to `connect-src` in **both** `nginx.conf.template` and `public/_headers`.
The unit test `src/security-headers.test.ts` fails if the two differ.

## 5. Verify

Locally, with production settings: see the Step 29 notes in
`claudeMD/fix-plan.md`. The same browser tests run against any deployment:

```sh
cd frontend
E2E_BASE_URL=https://your-domain npx playwright test e2e/smoke.spec.ts e2e/byok.spec.ts
```

These create test accounts. Run them before announcing the site, or against a
staging copy.

Also check:
- **securityheaders.com** or the **Mozilla Observatory** for your domain.
- In the browser's Network tab, run an analysis and confirm the API key is only
  sent to `generativelanguage.googleapis.com`.
- `GET /docs` returns 404 in production.

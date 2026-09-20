# Deploying ResearchGPT

ResearchGPT deploys as two containers plus a Postgres database. Users bring
their own LLM key, and **the server never holds one**.

```
browser ──HTTPS──▶ frontend (nginx: static app + security headers)
                      │  /api/*  (same origin, so cookies and CSP just work)
                      ▼
                   backend (FastAPI) ──▶ Postgres
browser ──HTTPS──▶ the user's LLM provider, direct with their key:
                   generativelanguage.googleapis.com | api.anthropic.com | api.openai.com
```

Both images are production-ready:
- **Backend:** multi-stage build, non-root user, JSON logs.
- **Frontend:** nginx serving the built app, with the API address set at start-up.

This setup has been verified locally as a production-like stack (see
[Verify](#6-verify)), and [§4](#4-render-worked-example) is a worked example for
Render. It has **not** been run on a live hosting platform yet, so adapt the
steps to your provider.

---

## 1. Database

Any Postgres 15+ works (Neon, Supabase, RDS, or a managed instance on your platform).

- `DATABASE_URL`: `postgresql+asyncpg://USER:PASS@HOST/DB`. Neon and Supabase hosts, and `?sslmode=require`, get TLS automatically.
- `SYNC_DATABASE_URL`: the same, as `postgresql://USER:PASS@HOST/DB` (used by migrations).

**Connection budget.** Each instance opens up to `DB_POOL_SIZE + DB_MAX_OVERFLOW`
connections (default 10 + 20 = 30), so *N* instances can ask for *N* × 30. Managed
Postgres plans cap connections well below that — Neon's smaller plans and Supabase's
direct port are common places to hit it. Either size the pool to your plan, or put a
pooler (PgBouncer, Neon's pooled endpoint, Supabase's transaction pooler) in front and
point `DATABASE_URL` at it. A pool that is too large fails under load with connection
timeouts surfacing as 500s, not at startup.

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
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT` | optional (10, 20, 30s). Per instance — see the connection budget above |
| `CORS_ORIGINS` | `["https://your-domain"]` |
| `FORWARDED_ALLOW_IPS` | IP or CIDR of your reverse proxy, so rate limits see real client IPs. Never `*` if the API port is reachable from the internet. |
| `RATE_LIMIT_STORAGE_URI` | `memory://` (per instance) or `redis://…` to share limits across instances |
| `SENTRY_DSN` | optional; events are scrubbed of cookies, auth headers and bodies |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, … | **must not be set**; the API refuses to start if they are |

**Other settings:**
- Port: binds `$PORT`, falling back to `8000`. Platforms that assign a port at runtime (Render, Fly, Cloud Run) work without changes.
- Health check: `GET /health`, which returns 503 when the database is unreachable.
- Keep the backend private if your platform allows it. Only the frontend container needs to reach it.

## 3. Frontend container (`frontend/Dockerfile`)

| Variable | Value |
|---|---|
| `API_UPSTREAM` | the backend's internal URL, e.g. `http://backend.internal:8000` (default `http://backend:8000`) |

It binds `$PORT` (default `80`) and serves:
- the app, with the CSP and other headers from `frontend/nginx.conf.template`
- `/api/*`, proxied to `API_UPSTREAM`

Terminate TLS in front of it (every platform does this for you).

> **Static host instead of a container?** `frontend/public/_headers` carries the
> same headers for Cloudflare Pages or Netlify. The host must **proxy** `/api/*`
> to the backend on the same origin; a redirect isn't enough, because cookies
> and the CSP rely on one origin. Netlify can do this in `_redirects`, e.g.
> `/api/*  https://api.example.com/api/:splat  200`.

## 4. Render (worked example)

[`render.yaml`](render.yaml) declares both services. Render's own Postgres is
deliberately not in it: the free one is deleted 30 days after creation, so point
the app at a database you keep (this project runs against Neon).

1. **Render → New → Blueprint**, pick the repo, let it read `render.yaml`.
2. Fill in the values it prompts for on `researchgpt-api`: `DATABASE_URL`
   (`postgresql+asyncpg://`, pooled endpoint), `SYNC_DATABASE_URL`
   (`postgresql://`, **direct** endpoint), `CONTACT_EMAIL`, and `CORS_ORIGINS`
   as `["https://<your-web-service>.onrender.com"]`. `SECRET_KEY` is generated.
3. Leave `API_UPSTREAM` on `researchgpt-web` for now; the API has no URL yet.
4. Apply. Once the API is live, set `API_UPSTREAM` to **its public URL** on free
   (`https://researchgpt-api-XXXX.onrender.com`) or its internal address on a
   paid plan (`http://researchgpt-api-XXXX:10000`), then redeploy the frontend.
5. **Run the migrations** — nothing does this for you:

   ```sh
   cd backend
   SYNC_DATABASE_URL='postgresql://…direct-endpoint…/neondb?sslmode=require' alembic upgrade head
   ```

   Render's pre-deploy command is paid-only and Docker services have no build
   command, so on the free plan this runs from your machine against the
   database's external URL. On a paid plan, set it as the pre-deploy command
   instead and it becomes part of every deploy.
6. Verify with [§6](#6-verify).

**Region.** Put both services in the same region as the database — Neon
`us-east-1` → `virginia`, `us-east-2` → `ohio`. The blueprint says `virginia`.

**What the free plan costs you, specifically:**

- Services sleep after 15 minutes idle and take ~1 min to wake, and a workspace
  gets 750 instance-hours a month shared across them — two always-on services
  would need about 1,460.
- A free service **can send** private-network requests but **cannot receive**
  them, so the frontend must proxy to the API's public URL. That means the API
  is internet-reachable, and `FORWARDED_ALLOW_IPS=*` (which per-IP rate limits
  need behind Render's router) can then be forged by anyone. On a paid plan,
  change the API to `type: pserv` and the problem disappears.
- A sleeping API kills a running collection job. The heartbeat handles it —
  the job is marked failed rather than hanging — but users see failed runs.

## 5. Adding another LLM provider later

Gemini, Claude and OpenAI ship enabled. Browser calls to any provider must be
allowed by the CSP, so a new one needs its API host in `connect-src` in **both**
`nginx.conf.template` and `public/_headers`. `src/security-headers.test.ts`
fails if the two files differ, or if the hosts don't match the providers the app
actually ships.

## 6. Verify

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
  sent to the provider's host (`generativelanguage.googleapis.com`,
  `api.anthropic.com` or `api.openai.com`) and never to `/api/*`.
- `GET /docs` returns 404 in production.

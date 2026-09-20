# ── Build: install dependencies into a virtualenv ───────────────────────────
FROM python:3.11-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY requirements.txt .
# All dependencies ship binary wheels (psycopg[binary], asyncpg, bcrypt…),
# so no compiler is needed.
RUN /venv/bin/pip install -r requirements.txt

# ── Runtime: slim image, non-root user ───────────────────────────────────────
FROM python:3.11-slim
ENV PATH="/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LOG_FORMAT=json \
    LOG_TO_FILE=false
RUN useradd --create-home --uid 10001 app
COPY --from=build /venv /venv
WORKDIR /app
COPY --chown=app:app . .
USER app
EXPOSE 8000

# Migrations are a separate release step, not part of startup, so several
# instances never race to migrate:  alembic upgrade head
#
# --proxy-headers: take the client IP from X-Forwarded-For (rate limits need it).
# Uvicorn trusts that header only from FORWARDED_ALLOW_IPS (default 127.0.0.1):
# set it to your reverse proxy's address; never "*" if the API is exposed.
#
# $PORT with a default: hosts like Render assign the port at runtime and expect
# the server to bind it. Shell form so the variable expands, and `exec` so
# uvicorn replaces the shell as PID 1 and still receives stop signals.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]

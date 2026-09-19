FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Storage dirs
RUN mkdir -p logs

EXPOSE 8000

# --proxy-headers: take the client IP from X-Forwarded-For (rate limits need it).
# Uvicorn trusts that header only from FORWARDED_ALLOW_IPS (default 127.0.0.1):
# set it to your reverse proxy's address, never to "*" if the API is exposed.
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers"]

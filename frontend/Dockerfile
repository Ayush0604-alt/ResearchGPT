FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# nginx renders /etc/nginx/templates/*.template into conf.d at startup,
# substituting environment variables such as API_UPSTREAM.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV API_UPSTREAM=http://backend:8000
# Hosts like Render assign the port at runtime; envsubst renders it into the
# template's listen directive. 80 keeps docker compose working unchanged.
ENV PORT=80
EXPOSE 80

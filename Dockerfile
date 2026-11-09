# syntax=docker/dockerfile:1

# ---- deps (native build for better-sqlite3) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- development (hot reload) ----
FROM node:20-bookworm-slim AS dev
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY . .
ENV NODE_ENV=development
ENV HOST=0.0.0.0
EXPOSE 5173 8787
CMD ["npm", "run", "dev:docker"]

# ---- frontend build ----
FROM deps AS build
COPY . .
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# ---- production ----
FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache python3 make g++ curl \
    && addgroup -S nihon && adduser -S nihon -G nihon

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && apk del python3 make g++

COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R nihon:nihon /app/data
USER nihon

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV SERVE_STATIC=true
ENV STATIC_DIR=dist
ENV DB_PATH=/app/data/nihon.db

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/health || exit 1

CMD ["node", "server/index.mjs"]

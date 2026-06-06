# SPDX-License-Identifier: AGPL-3.0-or-later
# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript -> build/ ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: production deps + compiled output only ----
FROM node:22-alpine AS runtime
ARG BUILD_SHA=unknown
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_PORT=8080 \
    CACHE_DIR=/data/cache/streams \
    BUILD_SHA=${BUILD_SHA}
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build

# Writable stream-cache dir. Mount a volume here to persist it across restarts;
# the cache is optional and re-fetchable, so an ephemeral dir is also fine.
RUN mkdir -p "$CACHE_DIR" && chown -R node:node /data
USER node

EXPOSE 8080

# /health is a plain GET that does not call the Intervals.icu API.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1 || exit 1

# Env (INTERVALS_API_KEY, INTERVALS_ATHLETE_ID, ...) is injected by the container
# runtime (--env-file / compose env_file / -e), so no node --env-file flag is used.
CMD ["node", "build/index.js"]

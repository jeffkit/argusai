# ========== Builder Stage ==========
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY .npmrc* ./

# Copy package manifests first for cache optimization
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/

# Build packages
RUN pnpm --filter argusai-core build && \
    pnpm --filter argusai-server build

# ========== Runtime Stage ==========
FROM node:20-alpine

RUN apk add --no-cache wget

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy full workspace for proper resolution of workspace deps
COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist/
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist/

# Install production deps only
RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /app/packages/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]

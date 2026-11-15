# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Lalit Krishna and contributors
#
# Multi-stage build. The final image serves the built web assets and runs the
# read-only server as a non-root user with no secrets in any layer.
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN pnpm build

FROM node:24-alpine AS runtime
RUN addgroup -S events && adduser -S events -G events
WORKDIR /app
ENV NODE_ENV=production
ENV EVENTS_MODE=in-cluster
ENV EVENTS_BIND_HOST=0.0.0.0
ENV EVENTS_PORT=8080

COPY --from=build /repo /app
USER events
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "--import", "tsx", "packages/server/src/main.ts"]

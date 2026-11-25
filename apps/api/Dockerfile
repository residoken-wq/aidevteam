# syntax=docker/dockerfile:1
# api image. Build context = repo root: docker build -f apps/api/Dockerfile .
# Base image pinned by digest (resolved from Docker Hub on 25/11/2026 for node:24.22.3-bookworm-slim).
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter "@aidevteam/api..."
RUN pnpm --filter "@aidevteam/api..." build
# pnpm v10 requires --legacy unless inject-workspace-packages=true (https://pnpm.io/cli/deploy)
RUN pnpm --filter @aidevteam/api deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

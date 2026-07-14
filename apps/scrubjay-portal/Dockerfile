# Base stage: Set up Node.js and pnpm
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
# pnpm 11 installs global bins to $PNPM_HOME/bin (older pnpm used $PNPM_HOME)
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
# turbo is pinned: release builds run with no layer cache, so an unpinned
# "latest" would silently change prune/build behavior with no lockfile to
# stop it. Keep in sync with the root devDependency.
RUN apk add --no-cache libc6-compat && \
    corepack enable && \
    pnpm install turbo@2.10.3 --global

FROM base AS builder
WORKDIR /usr/src/app
COPY . .
RUN turbo prune scrubjay-portal --docker

FROM base AS installer
WORKDIR /usr/src/app
COPY .gitignore .gitignore
# Dependency layers first: out/json holds only package.json files, so the
# pnpm install layer is reused across source-only changes; out/full (the
# source) must land after the install or every commit re-installs.
COPY --from=builder /usr/src/app/out/json/ .
COPY --from=builder /usr/src/app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /usr/src/app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile
COPY --from=builder /usr/src/app/out/full/ .
COPY turbo.json turbo.json
RUN turbo run build --filter=scrubjay-portal
# Self-contained prod tree: drops devDependencies and materializes workspace
# deps (@scrubjay/*) as real directories instead of symlinks into packages/,
# so the runner needs no workspace layout. The copied file set is the npm
# packlist — .output, drizzle (migrations, read from cwd at boot), otel, and
# scripts must stay listed in the app's package.json "files".
RUN pnpm --filter=scrubjay-portal deploy --prod --legacy /prod/scrubjay-portal

FROM node:24-alpine AS runner

WORKDIR /usr/src/app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

COPY --from=installer --chown=nodejs:nodejs /prod/scrubjay-portal ./

USER nodejs

ENV PORT=3100
EXPOSE 3100

# Single quotes are load-bearing: backticks or ${...} in double quotes would
# be expanded by /bin/sh before node runs. start-period covers migrations +
# DB connect. Alpine has no curl; node 24's global fetch does the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:" + (process.env.PORT ?? 3100) + "/api/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["sh", "scripts/docker-entry.sh"]

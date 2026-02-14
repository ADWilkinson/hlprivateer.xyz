ARG APP=api
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_WS_BASE_URL=

FROM oven/bun:1.2.19 AS builder

WORKDIR /app

COPY bun.lock package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY config ./config

RUN bun install --frozen-lockfile
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_BASE_URL=$NEXT_PUBLIC_WS_BASE_URL

RUN bun run build

FROM oven/bun:1.2.19 AS runtime

WORKDIR /app

ARG APP
ENV APP=$APP
ENV NODE_ENV=production

COPY --from=builder /app /app

RUN addgroup --system --gid 1001 hlp && adduser --system --ingroup hlp --uid 1001 hlp

USER hlp

CMD ["sh", "-lc", "case \"$APP\" in\n  api) bun run --cwd /app/apps/api start ;;\n  runtime) bun run --cwd /app/apps/runtime start ;;\n  ws-gateway) bun run --cwd /app/apps/ws-gateway start ;;\n  agent-runner) bun run --cwd /app/apps/agent-runner start ;;\n  web) bun run --cwd /app/apps/web start ;;\n  *) echo \"unknown APP value: $APP\"; exit 1 ;;\n esac"]

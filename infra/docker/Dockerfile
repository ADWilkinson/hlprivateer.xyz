ARG APP=api
ARG NEXT_PUBLIC_API_BASE_URL=
ARG NEXT_PUBLIC_WS_BASE_URL=

FROM oven/bun:1.2.19 AS builder

WORKDIR /app

COPY bun.lock package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY config ./config
COPY scripts ./scripts

RUN bun install --frozen-lockfile
RUN bun install -g @anthropic-ai/claude-code @openai/codex
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WS_BASE_URL=$NEXT_PUBLIC_WS_BASE_URL

RUN bun run build

FROM oven/bun:1.2.19 AS runtime

WORKDIR /app

ARG APP
ENV APP=$APP
ENV NODE_ENV=production
ENV HOME=/home/bun
ENV BUN_INSTALL=/home/bun/.bun
ENV PATH="/home/bun/.bun/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

COPY --from=builder /app /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/bun/.bun
RUN bun install -g @anthropic-ai/claude-code
RUN npm install -g @openai/codex@latest
RUN mkdir -p /home/bun/.bun/bin \
  && cp -f /usr/local/bin/bun /home/bun/.bun/bin/bun \
  && cp -f /usr/local/bin/claude /home/bun/.bun/bin/claude || true \
  && ln -sf /home/bun/.bun/bin/bun /usr/local/bin/bun \
  && ln -sf /home/bun/.bun/bin/claude /usr/local/bin/claude \
  && ln -sf /usr/lib/node_modules/@openai/codex/bin/codex.js /home/bun/.bun/bin/codex \
  && ln -sf /usr/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex
RUN chown -R bun:bun /home/bun/.bun
RUN mkdir -p /app/journals && chown bun:bun /app/journals

USER bun

CMD ["sh", "-lc", "case \"$APP\" in\n  api) bun run --cwd /app/apps/api start ;;\n  runtime) bun run --cwd /app/apps/runtime start ;;\n  ws-gateway) bun run --cwd /app/apps/ws-gateway start ;;\n  agent-runner) bun run --cwd /app/apps/agent-runner start ;;\n  web) bun run --cwd /app/apps/web start ;;\n  *) echo \"unknown APP value: $APP\"; exit 1 ;;\n esac"]

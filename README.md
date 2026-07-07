# omni-relay

A universal LLM API relay and protocol translator for OpenAI and Anthropic, built for Cloudflare Workers.

## Project goal

Let **Codex CLI** and **Claude CLI** share one relay while either client can target either an **OpenAI-compatible** or **Anthropic-compatible** upstream, in both directions:

- OpenAI-style clients/routes onto Anthropic upstreams
- Anthropic-style clients/routes onto OpenAI upstreams

Live verification targets:

- `POST /v1/responses` → Anthropic upstream
- `POST /v1/messages` → OpenAI upstream
- `POST /v1/chat/completions` → either upstream where compatible

Relay auth is client-compatible: `Authorization: Bearer <relay-key>` for OpenAI clients, `x-api-key: <relay-key>` for Anthropic clients.

**MVP scope:** OpenAI Chat Completions, Responses, and Anthropic Messages ingress; OpenAI and Anthropic upstream support; custom function tools as the only guaranteed cross-provider tool abstraction.

Deferred until after MVP: Gemini, Workers AI, OpenRouter, provider-native cross-provider tools, reasoning/thinking normalization, and failover/cost-aware routing.

## Backend compatibility

Backend selection is a configuration and routing concern, not a client lock-in. Known-compatible base URLs:

- Anthropic-compatible: `https://open.bigmodel.cn/api/anthropic/v1`
- OpenAI-compatible: `https://open.bigmodel.cn/api/coding/paas/v4`

For cross-provider calls, set `providerHint` in the request body when model-prefix auto-routing is not enough.

## Quick start

The Worker deploys via Wrangler. Configure secrets first, then build, test, and deploy.

### Secrets

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANTHROPIC_AUTH_TOKEN
npx wrangler secret put RELAY_API_KEY
```

- `OPENAI_API_KEY` — OpenAI-routed `/v1/chat/completions`, `/v1/responses`, and OpenAI cross-provider requests
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` — Anthropic-routed `/v1/messages` and Anthropic cross-provider requests
- `RELAY_API_KEY` — optional but recommended; protects relay routes and `/v1/debug/translate`

## Development
### Build, test, deploy

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npx wrangler deploy
```

### Runtime config

- `nodejs_compat` is **not enabled**; the relay uses only platform-native Web APIs.
- `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are **required** runtime vars for any upstream call. There is no fallback to `api.openai.com` or `api.anthropic.com` — only the configured compatible upstreams are used.

### Verify

```bash
# Health
curl https://<worker>.workers.dev/healthz

# OpenAI Responses → Anthropic upstream
curl https://<worker>.workers.dev/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <relay-key>' \
  -d '{"providerHint":"anthropic","model":"glm-4.7","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: omni relay ok"}]}]}'

# Anthropic Messages → OpenAI upstream
curl https://<worker>.workers.dev/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: <relay-key>' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"providerHint":"openai","model":"glm-5.2","max_tokens":256,"messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

Use staging first when changing bindings, migrations, or upstream base URLs; promote to production only after compute verification succeeds.

```bash
npx wrangler versions list
npx wrangler rollback   # if a deploy needs reversing
```


# Deployment and Verification Notes

## Worker

The Worker is currently configured and deployed through Wrangler.

### Commands

```bash
npm install
npm run typecheck
npm test
npm run cf-typegen
npx wrangler deploy
```

## Required secrets

Set these before attempting full upstream verification:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ANTHROPIC_AUTH_TOKEN
npx wrangler secret put RELAY_API_KEY
```

### Secret usage
- `OPENAI_API_KEY` — required for OpenAI-routed `/v1/chat/completions`, `/v1/responses`, and OpenAI-selected cross-provider requests
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` — required for Anthropic-routed `/v1/messages` and Anthropic-selected cross-provider requests
- `RELAY_API_KEY` — optional, but recommended to protect relay routes and `/v1/debug/translate`
- ingress auth accepts either `Authorization: Bearer <relay-key>` or `x-api-key: <relay-key>`

## Codex CLI client setup

If you want Codex CLI to use this relay directly, configure a local client-side environment variable:

- `RELAYX_API_KEY` — the local shell variable that Codex uses for the relay's bearer auth

Recommended local setup:

- store the key in `~/.codex/relayx_api_key`
- export `RELAYX_API_KEY` from `~/.bashrc`
- point the Codex provider base URL at:
  - `https://relayx.sim4d.workers.dev/v1`

Important:

- `RELAYX_API_KEY` is a **client-side shell variable**
- `RELAY_API_KEY` is the **server-side Worker secret**
- they should contain the same secret value, but they are used in different places

## Rate limiting configuration

The relay now prefers a Durable Object-backed limiter that is verifiable on Workers compute.

Required non-secret vars:

- `RATE_LIMIT_MAX`
- `RATE_LIMIT_PERIOD_SECONDS`

Required binding:

- `RELAY_RATE_LIMITER_DO`

The checked-in `wrangler.jsonc` includes:

- a `RelayRateLimiter` Durable Object binding
- a `v1` SQLite migration for that class
- production defaults of `60 requests / 60 seconds`
- staging defaults of `2 requests / 10 seconds`

## Runtime configuration notes

- `nodejs_compat` is **not enabled**. The current relay only depends on platform-native Web APIs and does not require Node.js compatibility shims.
- `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are now **required** runtime vars for any upstream call path.
- The relay does **not** fall back to `api.openai.com` or `api.anthropic.com`; it only calls the configured compatible upstream base URLs from Wrangler env/vars.
- Production defaults now target the compatible backends used by this project:
  - OpenAI-compatible: `https://open.bigmodel.cn/api/coding/paas/v4`
  - Anthropic-compatible: `https://open.bigmodel.cn/api/anthropic/v1`
- Staging uses the same compatible backend pair with a much stricter limiter for proof-oriented testing.

## Verification checklist

### Health
```bash
curl https://<worker>.workers.dev/healthz
```

### OpenAI Chat
```bash
curl https://<worker>.workers.dev/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-5.4-nano","messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

### OpenAI Responses
```bash
curl https://<worker>.workers.dev/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <relay-key>' \
  -d '{"providerHint":"anthropic","model":"glm-4.7","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: omni relay ok"}]}]}'
```

### Anthropic Messages
```bash
curl https://<worker>.workers.dev/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: <relay-key>' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"providerHint":"openai","model":"glm-5.2","max_tokens":256,"messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

### Debug translation
```bash
curl https://<worker>.workers.dev/v1/debug/translate \
  -H 'content-type: application/json' \
  -d '{"protocol":"chat","payload":{"model":"gpt-5.4-nano","messages":[{"role":"user","content":"Hello"}]}}'
```

## Current verification status

As of July 6, 2026:

- staging and production both serve `/healthz`
- staging and production both verified:
  - OpenAI-style ingress → Anthropic-compatible upstream
  - Anthropic-style ingress → OpenAI-compatible upstream
- staging verified:
  - end-to-end SSE streaming on compute
  - Durable Object-backed `429` rate limiting on compute
- production verified:
  - debug route remains disabled by default


## Rate-limit verification

Use staging to prove `429` behavior on compute:

```bash
for i in 1 2 3; do
  curl https://relayx-staging.sim4d.workers.dev/v1/debug/translate \
    -H 'content-type: application/json' \
    -H 'x-api-key: <relay-key>' \
    --data '{"protocol":"chat","payload":{"model":"gpt-5-mini","messages":[{"role":"user","content":"Hello"}]}}'
  echo
done
```

With the current staging config (`2 requests / 10 seconds`), the third request should return a structured `429`.

## Debug route security

- `/v1/debug/translate` is **disabled by default in production**.
- Enable it by setting `ENABLE_DEBUG_ROUTES=true`.
- It also requires `RELAY_API_KEY` to be configured and supplied as either:
  - `Authorization: Bearer <key>`
  - `x-api-key: <key>`

## Rollback notes

If a deployment needs to be reversed:

```bash
npx wrangler versions list
npx wrangler rollback
```

Use staging first when changing bindings, migrations, or upstream base URLs, then promote to production only after compute verification succeeds.

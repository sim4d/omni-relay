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
npx wrangler secret put RELAY_API_KEY
```

### Secret usage
- `OPENAI_API_KEY` — required for OpenAI-routed `/v1/chat/completions`, `/v1/responses`, and OpenAI-selected cross-provider requests
- `ANTHROPIC_API_KEY` — required for Anthropic-routed `/v1/messages` and Anthropic-selected cross-provider requests
- `RELAY_API_KEY` — optional, but recommended to protect relay routes and `/v1/debug/translate`

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
  -d '{"model":"gpt-5.4-nano","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: omni relay ok"}]}]}'
```

### Anthropic Messages
```bash
curl https://<worker>.workers.dev/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"claude-sonnet-4-0","max_tokens":64,"messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

### Debug translation
```bash
curl https://<worker>.workers.dev/v1/debug/translate \
  -H 'content-type: application/json' \
  -d '{"protocol":"chat","payload":{"model":"gpt-5.4-nano","messages":[{"role":"user","content":"Hello"}]}}'
```

## Current known verification blockers

Full live upstream verification depends on valid provider secrets being present in the deployed Worker environment. If a provider secret is missing or invalid, the Worker should still return a structured JSON error that identifies the missing or rejected upstream credential.


## Optional rate limiting binding

You can enable Cloudflare-native rate limiting by adding a `ratelimits` binding to `wrangler.jsonc` and exposing it as `RATE_LIMITER`:

```jsonc
{
  "ratelimits": [
    {
      "name": "RATE_LIMITER",
      "namespace_id": "relayx-rate-limit-v1",
      "simple": {
        "limit": 120,
        "period": 60
      }
    }
  ]
}
```

When present, the Worker uses the binding on `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and `/v1/debug/translate`.

## Debug route security

- `/v1/debug/translate` is **disabled by default in production**.
- Enable it by setting `ENABLE_DEBUG_ROUTES=true`.
- It also requires `RELAY_API_KEY` to be configured and supplied as `Authorization: Bearer <key>`.

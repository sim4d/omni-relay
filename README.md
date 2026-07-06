# omni-relay

A universal LLM API relay and protocol translator for OpenAI and Anthropic, built for Cloudflare Workers.

## Project goal

The major goal of this project is to let **Codex CLI** and **Claude CLI** share the same relay while remaining free to target either:

- an **OpenAI-compatible backend**
- an **Anthropic-compatible backend**

That interchangeability needs to work in both directions:

- OpenAI-style clients and routes can be forced onto Anthropic-compatible upstreams
- Anthropic-style clients and routes can be forced onto OpenAI-compatible upstreams

Current live verification targets are:

- `POST /v1/responses` → Anthropic-compatible upstream
- `POST /v1/messages` → OpenAI-compatible upstream
- `POST /v1/chat/completions` → either upstream where the feature set is compatible

Relay authentication is intentionally client-compatible:

- OpenAI-style clients can use `Authorization: Bearer <relay-key>`
- Anthropic-style clients can use `x-api-key: <relay-key>`

## MVP scope

The current MVP focuses on:
- OpenAI Chat Completions ingress
- OpenAI Responses ingress
- Anthropic Messages ingress
- OpenAI upstream provider support
- Anthropic upstream provider support
- custom function tools as the only guaranteed cross-provider tool abstraction

Explicitly deferred until after MVP:
- Gemini
- Workers AI
- OpenRouter
- provider-native tools as cross-provider abstractions
- reasoning/thinking normalization guarantees
- failover routing and cost-aware routing

## Backend compatibility notes

The relay is designed so backend selection is mostly a configuration and routing concern, not a client-lock-in decision.

Known-compatible backend shapes for this project include:

- Anthropic-compatible base URLs such as `https://open.bigmodel.cn/api/anthropic/v1`
- OpenAI-compatible base URLs such as `https://cpa.sim4ai.ccwu.cc/v1`

If you want to target BigModel directly:

- use `https://open.bigmodel.cn/api/paas/v4/` for the standard OpenAI-compatible API
- use `https://open.bigmodel.cn/api/coding/paas/v4` for the GLM Coding Plan endpoint

The commonly mistyped `.../api/pass/v4` path will not work.

For cross-provider calls, set `providerHint` in the request body when model-prefix auto-routing is not enough.

## Development

```bash
npm install
npm run cf-typegen
npm run dev
```

Required secrets for later milestones:
- `RELAY_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`


## Deployment

See `docs/deployment.md` for secret setup, deploy commands, and remote verification examples.


## Security notes

- `/v1/debug/translate` is disabled by default in production.
- Set `ENABLE_DEBUG_ROUTES=true` and configure `RELAY_API_KEY` if you need the debug endpoint remotely.
- Relay routes enforce rate limiting through a Durable Object binding when `RATE_LIMIT_MAX`, `RATE_LIMIT_PERIOD_SECONDS`, and `RELAY_RATE_LIMITER_DO` are configured.

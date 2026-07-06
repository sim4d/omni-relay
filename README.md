# omni-relay

A universal LLM API relay and protocol translator for OpenAI and Anthropic, built for Cloudflare Workers.

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

## Development

```bash
npm install
npm run cf-typegen
npm run dev
```

Required secrets for later milestones:
- `RELAY_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`


## Deployment

See `docs/deployment.md` for secret setup, deploy commands, and remote verification examples.


## Security notes

- `/v1/debug/translate` is disabled by default in production.
- Set `ENABLE_DEBUG_ROUTES=true` and configure `RELAY_API_KEY` if you need the debug endpoint remotely.
- If a `RATE_LIMITER` binding is configured, relay routes will enforce Cloudflare-native rate limiting.

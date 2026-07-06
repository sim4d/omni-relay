# omni-relay MVP Capabilities

## Scope decisions

The following decisions are locked for Milestone 1 and will be treated as the default implementation contract unless explicitly changed later:

1. **Gemini is out of MVP**.
2. **Provider-native tools are excluded from MVP cross-provider translation**.
3. **Single-tenant is the only MVP operating mode**.
4. **OpenAI upstream defaults to the Responses API where practical**, while still supporting Chat Completions ingress.
5. **Unsupported features fail explicitly by default** rather than silently degrading.

## Supported ingress protocols

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages

## Supported upstream providers

- OpenAI
- Anthropic

## Supported MVP features

- Text-only requests and responses
- Multi-turn conversational input
- Instructions/system prompts
- Non-streaming requests and responses
- Streaming contract design in the IR
- Custom function tools as a normalized abstraction
- Provider hinting
- Model-to-provider routing foundations
- Structured error responses

## Deferred from MVP

- Gemini
- Workers AI
- OpenRouter
- Provider-native built-in tools as cross-provider abstractions
- Guaranteed reasoning/thinking block normalization
- Multimodal image/file normalization
- Multi-tenant auth, quotas, and billing
- Failover and cost-aware routing

# omni-relay — Execution Checklist

This checklist converts `new-plan.md` into concrete implementation tasks.

---

## 0. Product decisions to lock before coding

- [ ] Decide whether **Gemini is out of MVP**
- [ ] Decide whether **provider-native tools are excluded from MVP cross-provider translation**
- [ ] Decide whether **single-tenant is the only MVP mode**
- [ ] Decide whether **OpenAI upstream defaults to Responses API when possible**
- [ ] Decide whether unsupported features should **fail explicitly** by default
- [ ] Update `README.md` so its scope matches the implementation plan

**Output:** written scope decisions in `docs/capabilities.md`

---

## 1. Bootstrap the Worker project

### Project setup
- [ ] Initialize `package.json` if missing
- [ ] Add TypeScript setup
- [ ] Add Wrangler config
- [ ] Add Vitest test setup
- [ ] Add npm scripts:
  - [ ] `dev`
  - [ ] `deploy`
  - [ ] `test`
  - [ ] `typecheck`
  - [ ] `lint` if used

### Files to create
- [ ] `src/index.ts`
- [ ] `src/router.ts`
- [ ] `src/config.ts`
- [ ] `src/env.ts`
- [ ] `src/errors.ts`
- [ ] `src/auth.ts`
- [ ] `src/observability.ts`
- [ ] `wrangler.jsonc`
- [ ] `tsconfig.json`
- [ ] `.gitignore` updates if needed

### Worker baseline
- [ ] Add module Worker `fetch()` entrypoint
- [ ] Add `GET /healthz`
- [ ] Add placeholder handlers for:
  - [ ] `POST /v1/chat/completions`
  - [ ] `POST /v1/responses`
  - [ ] `POST /v1/messages`
- [ ] Return structured `404` and `405` responses
- [ ] Add request ID generation for every request

**Output:** app boots locally with `wrangler dev` and `/healthz` returns 200

---

## 2. Add Cloudflare runtime configuration

### Wrangler
- [ ] Set current `compatibility_date`
- [ ] Enable `observability`
- [ ] Add required `vars` placeholders
- [ ] Decide whether `nodejs_compat` is needed

### Secrets
- [ ] Document required secrets:
  - [ ] relay API key
  - [ ] OpenAI API key
  - [ ] Anthropic API key
- [ ] Add setup instructions for `wrangler secret put`

### Environment typing
- [ ] Add `Env` typing strategy
- [ ] Run `wrangler types` if using generated runtime types

**Output:** config is deployable and secrets contract is documented

---

## 3. Write the capability and translation policy docs

### Docs to create
- [ ] `docs/capabilities.md`
- [ ] `docs/unsupported-features.md`
- [ ] `docs/translation-rules.md`

### Must document
- [ ] supported ingress protocols
- [ ] supported upstream providers
- [ ] supported features in MVP
- [ ] unsupported features in MVP
- [ ] lossy translation cases
- [ ] custom function tools as the only guaranteed cross-provider tool abstraction
- [ ] same-provider pass-through vs cross-provider rejection behavior

**Output:** explicit feature policy that implementation can enforce

---

## 4. Define the canonical IR

### Core files
- [ ] `src/core/ir.ts`
- [ ] `src/core/stream-events.ts`
- [ ] `src/core/capabilities.ts`
- [ ] `src/core/feature-gates.ts`
- [ ] `src/core/routing.ts`

### Request IR tasks
- [ ] Define `ProviderHint`
- [ ] Define `ContentBlock`
- [ ] Define `NormalizedMessage`
- [ ] Define `NormalizedTool`
- [ ] Define `ToolChoice`
- [ ] Define `NormalizedRequest`

### Result IR tasks
- [ ] Define `NormalizedResult`
- [ ] Define token usage shape
- [ ] Define provider extension fields

### Stream IR tasks
- [ ] Define normalized stream event union
- [ ] Include tool call streaming events
- [ ] Include usage and termination events
- [ ] Include normalized stream error event

**Output:** stable IR types that all protocols/providers use

---

## 5. Build validation and error handling

### Files
- [ ] `src/errors.ts`
- [ ] protocol `schema.ts` files
- [ ] reusable JSON/body parsing helpers

### Tasks
- [ ] Define canonical error classes:
  - [ ] `ValidationError`
  - [ ] `AuthenticationError`
  - [ ] `AuthorizationError`
  - [ ] `UnsupportedFeatureError`
  - [ ] `ProviderSelectionError`
  - [ ] `UpstreamAPIError`
  - [ ] `StreamProtocolError`
  - [ ] `TimeoutError`
  - [ ] `InternalRelayError`
- [ ] Add consistent JSON error renderer
- [ ] Add protocol-specific outward error shapes where needed
- [ ] Add safe request JSON parsing helper
- [ ] Add input size / malformed JSON guardrails if desired

**Output:** every request either validates cleanly or fails with a structured error

---

## 6. Implement protocol schemas

### OpenAI Chat
- [ ] `src/protocols/openai-chat/schema.ts`
- [ ] Define request schema
- [ ] Validate `messages`
- [ ] Validate `tools`
- [ ] Validate `tool_choice`
- [ ] Validate stream flag and generation settings

### OpenAI Responses
- [ ] `src/protocols/openai-responses/schema.ts`
- [ ] Define request schema
- [ ] Validate `input`
- [ ] Validate tools and output format fields
- [ ] Validate stream settings

### Anthropic Messages
- [ ] `src/protocols/anthropic-messages/schema.ts`
- [ ] Define request schema
- [ ] Validate `system`
- [ ] Validate block-based `messages`
- [ ] Validate `tools`
- [ ] Validate tool choice settings
- [ ] Validate stream settings

**Output:** schemas exist before parsing logic

---

## 7. Implement ingress parsers

### OpenAI Chat parser
- [ ] `src/protocols/openai-chat/parse.ts`
- [ ] Convert `messages` into normalized messages
- [ ] Convert assistant tool calls into `tool_call` content blocks
- [ ] Normalize `tools`
- [ ] Normalize `tool_choice`
- [ ] Normalize `temperature`, token limits, stop sequences
- [ ] Preserve OpenAI-specific leftovers under `extensions.openai`

### OpenAI Responses parser
- [ ] `src/protocols/openai-responses/parse.ts`
- [ ] Convert `input` items into normalized messages/content blocks
- [ ] Normalize instruction-like fields
- [ ] Normalize tools/tool choice/output settings
- [ ] Preserve response-only provider metadata under `extensions.openai`

### Anthropic parser
- [ ] `src/protocols/anthropic-messages/parse.ts`
- [ ] Convert `system` into instructions/content blocks
- [ ] Convert message blocks into normalized messages
- [ ] Convert `tool_use` to `tool_call`
- [ ] Convert `tool_result` to normalized tool result blocks
- [ ] Preserve Anthropic-specific leftovers under `extensions.anthropic`

**Output:** all three ingress protocols can normalize requests into one IR

---

## 8. Add provider selection and feature gating

### Routing rules
- [x] Respect explicit `providerHint`
- [x] Add model-to-provider mapping table — realized as per-target model globs (`OPENAI_MODEL_<N>` / `ANTHROPIC_MODEL_<N>`); a request matches the first target whose glob covers its model
- [x] Add fallback model-prefix heuristics — replaced by explicit globs (no implicit prefix table)
- [x] Add per-route default behavior where needed

### Feature gating
- [ ] Reject unsupported cross-provider provider-native tools
- [ ] Reject unsupported reasoning/thinking translation cases
- [ ] Reject unsupported multimodal cases if not implemented
- [ ] Reject unsupported structured output cases if not implemented

### Deliverables
- [ ] provider selection function
- [ ] capability checker function
- [ ] explicit error messages for routing/gating failures

**Output:** relay can decide provider before making upstream requests

---

## 9. Implement OpenAI provider adapter

### Files
- [ ] `src/providers/openai/client.ts`
- [ ] `src/providers/openai/map-request.ts`
- [ ] `src/providers/openai/map-response.ts`
- [ ] `src/providers/openai/map-stream.ts`

### Request mapping tasks
- [ ] Map normalized request to OpenAI upstream payload
- [ ] Prefer OpenAI Responses API upstream where chosen
- [ ] Map custom function tools
- [ ] Map tool choice
- [ ] Map generation settings
- [ ] Map structured output fields if supported

### Client tasks
- [ ] Add authenticated `fetch` wrapper
- [ ] Add upstream timeout behavior if needed
- [ ] Add upstream error capture and redaction

### Response tasks
- [ ] Map non-streaming upstream response to `NormalizedResult`
- [ ] Map usage and finish reason
- [ ] Preserve upstream IDs/metadata where useful

**Output:** one working non-streaming normalized path through OpenAI

---

## 10. Implement Anthropic provider adapter

### Files
- [ ] `src/providers/anthropic/client.ts`
- [ ] `src/providers/anthropic/map-request.ts`
- [ ] `src/providers/anthropic/map-response.ts`
- [ ] `src/providers/anthropic/map-stream.ts`

### Request mapping tasks
- [ ] Map normalized request to Anthropic Messages payload
- [ ] Map instructions/system field correctly
- [ ] Map custom tools
- [ ] Map tool choice
- [ ] Map output limits and generation settings

### Client tasks
- [ ] Add authenticated `fetch` wrapper
- [ ] Include required Anthropic headers/versioning
- [ ] Add upstream error capture and redaction

### Response tasks
- [ ] Map non-streaming upstream response to `NormalizedResult`
- [ ] Map content blocks, usage, and stop reason

**Output:** one working non-streaming normalized path through Anthropic

---

## 11. Implement egress renderers

### OpenAI Chat renderer
- [ ] `src/protocols/openai-chat/render.ts`
- [ ] Render assistant text output
- [ ] Render tool calls in chat-completions shape
- [ ] Render usage and finish reason
- [ ] Emit correct object type/id fields if desired

### OpenAI Responses renderer
- [ ] `src/protocols/openai-responses/render.ts`
- [ ] Render normalized output blocks into responses-compatible payload
- [ ] Preserve response metadata if available
- [ ] Render usage and finish reason

### Anthropic renderer
- [ ] `src/protocols/anthropic-messages/render.ts`
- [ ] Render content blocks into Anthropic response shape
- [ ] Render tool use output where supported
- [ ] Render stop reason and usage

### Shared task
- [ ] Document where rendering is lossy or partial

**Output:** each route can return protocol-native non-streaming responses

---

## 12. Wire end-to-end non-streaming handlers

### Handlers to finish
- [ ] `POST /v1/chat/completions`
- [ ] `POST /v1/responses`
- [ ] `POST /v1/messages`

### Per-handler flow
- [ ] authenticate request
- [ ] parse JSON
- [ ] validate against protocol schema
- [ ] normalize to IR
- [ ] select provider
- [ ] apply feature gating
- [ ] call provider adapter
- [ ] render back into caller protocol
- [ ] attach request ID / debug-safe headers

**Output:** non-streaming MVP works across all three ingress protocols

---

## 13. Add streaming infrastructure

### Core utilities
- [ ] `src/lib/sse.ts`
- [ ] streaming response helpers
- [ ] incremental SSE/event parser
- [ ] stream-safe text encoder/decoder utilities

### Normalized event model
- [ ] finalize normalized event types
- [ ] add helper for event dispatch/encoding

### OpenAI stream support
- [ ] map OpenAI upstream stream to normalized events
- [ ] render normalized events as OpenAI Chat chunks
- [ ] render normalized events as OpenAI Responses events

### Anthropic stream support
- [ ] map Anthropic upstream event stream to normalized events
- [ ] render normalized events as Anthropic-compatible stream events

### Runtime concerns
- [ ] ensure `text/event-stream` headers are correct
- [ ] do not buffer full stream
- [ ] handle upstream disconnects and partial failures cleanly

**Output:** streaming works for at least one provider and one ingress route first, then all target routes

---

## 14. Add auth and relay access control

### MVP auth
- [ ] validate relay bearer token
- [ ] reject missing/invalid auth consistently
- [ ] load upstream provider keys from `env`

### Optional next step
- [ ] design per-tenant auth abstraction without implementing full tenancy yet

**Output:** relay is not publicly open by default

---

## 15. Add rate limiting

### Tasks
- [ ] choose Cloudflare-native rate limiting approach
- [ ] implement middleware for API key-based throttling
- [ ] add consistent `429` response shape
- [ ] optionally add stricter limits for streaming or expensive routes

**Output:** basic abuse protection exists before production exposure

---

## 16. Add observability and debugging

### Logging
- [ ] add structured JSON logs
- [ ] log request ID
- [ ] log ingress protocol
- [ ] log selected provider
- [ ] log target model
- [ ] log stream mode
- [ ] log response status
- [ ] log latency timings
- [ ] redact secrets and sensitive payloads

### Debug endpoint
- [ ] add `/v1/debug/translate`
- [ ] gate to admin-only access
- [ ] redact payloads/secrets
- [ ] make disableable in production

**Output:** failures are diagnosable without leaking secrets

---

## 17. Build test coverage

### Test setup
- [ ] create `tests/fixtures`
- [ ] create `tests/unit`
- [ ] create `tests/integration`
- [ ] create `tests/golden`

### Unit tests
- [ ] IR helpers
- [ ] routing logic
- [ ] capability gating
- [ ] error rendering

### Parser snapshot tests
- [ ] OpenAI Chat request fixtures
- [ ] OpenAI Responses request fixtures
- [ ] Anthropic Messages request fixtures

### Renderer snapshot tests
- [ ] OpenAI Chat renderer outputs
- [ ] OpenAI Responses renderer outputs
- [ ] Anthropic renderer outputs

### Adapter tests
- [ ] normalized request → upstream OpenAI payload
- [ ] normalized request → upstream Anthropic payload
- [ ] upstream response → normalized result

### Golden translation tests
- [ ] Chat → OpenAI → Chat
- [ ] Chat → Anthropic → Chat
- [ ] Responses → Anthropic → Responses
- [ ] Messages → OpenAI → Messages

### Streaming tests
- [ ] text delta path
- [ ] tool call delta path
- [ ] interrupted stream path
- [ ] upstream error mid-stream path

### Unsupported feature tests
- [ ] provider-native tool rejection
- [ ] reasoning/thinking unsupported rejection
- [ ] unsupported multimodal rejection

**Output:** protocol translation behavior is regression-testable

---

## 18. Deployment readiness

### Pre-deploy
- [ ] verify local dev path
- [ ] verify remote/staging path
- [ ] verify one end-to-end non-streaming request against each supported ingress route
- [ ] verify one end-to-end streaming request
- [ ] verify auth and rate limit behavior
- [ ] verify logs/redaction behavior

### Deployment tasks
- [ ] add deploy command/script
- [ ] document secret provisioning
- [ ] document rollback approach
- [ ] optionally add `staging` and `production` environments

**Output:** project is safe to deploy and operate

---

## Recommended implementation order

### Milestone 1 — Skeleton and contracts
- [ ] bootstrap Worker
- [ ] add Wrangler/TS/test setup
- [ ] write capabilities docs
- [ ] define IR
- [ ] define errors and schemas

### Milestone 2 — Non-streaming first path
- [ ] implement OpenAI Chat parser
- [ ] implement provider routing
- [ ] implement OpenAI adapter
- [ ] implement OpenAI Chat renderer
- [ ] make `/v1/chat/completions` work end-to-end

### Milestone 3 — Complete non-streaming MVP
- [ ] add OpenAI Responses parser/renderer
- [ ] add Anthropic parser/renderer
- [ ] add Anthropic adapter
- [ ] make all three ingress routes work non-streaming

### Milestone 4 — Tool support
- [ ] implement custom function tool normalization
- [ ] implement tool choice normalization
- [ ] add unsupported-feature rejections

### Milestone 5 — Streaming
- [ ] implement normalized stream events
- [ ] implement upstream stream mappers
- [ ] implement protocol-specific stream renderers

### Milestone 6 — Hardening
- [ ] auth
- [ ] rate limiting
- [ ] observability
- [ ] debug endpoint
- [ ] deploy validation

---

## Suggested first success target

Build this path first:
- [ ] `POST /v1/chat/completions`
- [ ] validate request
- [ ] normalize to IR
- [ ] route to OpenAI
- [ ] call upstream non-streaming
- [ ] render chat-completions response

Once that works, expand to:
- [ ] OpenAI Responses ingress
- [ ] Anthropic Messages ingress
- [ ] cross-provider routing
- [ ] streaming

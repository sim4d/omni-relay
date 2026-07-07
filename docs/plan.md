# omni-relay — Detailed Implementation Plan

## Executive Summary

Build `omni-relay` as a **Cloudflare Workers-based LLM protocol gateway** that accepts multiple client-facing protocols, normalizes them into a **single canonical intermediate representation (IR)**, routes requests to upstream providers, and renders results back into the caller's expected protocol.

### MVP recommendation

Start with:
- **Ingress protocols**
  - OpenAI Chat Completions
  - OpenAI Responses
  - Anthropic Messages
- **Upstream providers**
  - OpenAI
  - Anthropic
- **Cross-provider tool support**
  - custom function tools only

Explicitly defer until after MVP:
- Gemini
- Workers AI
- OpenRouter
- provider-native built-in tools as cross-provider abstractions
- reasoning/thinking normalization guarantees
- failover routing
- cost-aware routing
- multi-tenant billing/quota logic

---

## Core Architecture Decision

Do **not** implement protocol translation as a pairwise matrix like:
- Responses ↔ Chat
- Messages ↔ Chat
- Messages ↔ Responses

That approach grows poorly and becomes fragile.

Instead, implement three layers:

1. **Ingress normalizers**
   - protocol request → canonical IR
2. **Provider adapters**
   - IR → upstream provider request
   - upstream provider response/stream → normalized result/events
3. **Egress renderers**
   - normalized result/events → requested client protocol

This architecture scales much better as protocols and providers are added.

---

## Goals

### Primary goals
- Expose OpenAI-compatible and Anthropic-compatible endpoints from one Worker
- Allow clients like Codex CLI, Claude clients, and OpenAI SDK clients to talk to one gateway
- Support cross-provider request routing where features are compatible
- Preserve streaming behavior efficiently on Cloudflare Workers

### Non-goals for MVP
- Perfect lossless translation across all provider-specific features
- Cross-provider normalization of provider-native tools
- Durable session persistence abstraction across all upstream APIs
- Complex multi-tenant administration UI or billing engine

---

## Proposed Repository Layout

```txt
src/
  index.ts
  router.ts
  config.ts
  env.ts
  errors.ts
  auth.ts
  observability.ts

  core/
    ir.ts
    capabilities.ts
    routing.ts
    stream-events.ts
    feature-gates.ts

  protocols/
    openai-chat/
      schema.ts
      parse.ts
      render.ts
      stream.ts
    openai-responses/
      schema.ts
      parse.ts
      render.ts
      stream.ts
    anthropic-messages/
      schema.ts
      parse.ts
      render.ts
      stream.ts

  providers/
    openai/
      client.ts
      map-request.ts
      map-response.ts
      map-stream.ts
    anthropic/
      client.ts
      map-request.ts
      map-response.ts
      map-stream.ts

  lib/
    json.ts
    sse.ts
    fetch.ts
    headers.ts
    ids.ts
    redact.ts
    timing.ts

docs/
  capabilities.md
  translation-rules.md
  unsupported-features.md

tests/
  fixtures/
    openai-chat/
    openai-responses/
    anthropic-messages/
    streams/
  unit/
  integration/
  golden/
```

---

## Phase 0 — Scope Freeze and Capability Matrix

Before coding, define what is supported in MVP.

### Deliverables
- `docs/capabilities.md`
- `docs/unsupported-features.md`
- `docs/translation-rules.md`

### Capability matrix should include
- plain text requests
- multi-turn conversation input
- system instructions
- streaming responses
- custom function tools
- tool_choice behavior
- JSON-schema / structured outputs
- stop sequences
- temperature
- max output tokens
- reasoning/thinking blocks
- image/file inputs
- provider-native tools

### Required policy decisions
1. **Custom function tools are the only guaranteed cross-provider tool abstraction in MVP**
2. **Provider-native advanced features may only be passed through on same-provider paths**
3. **Unsupported cross-provider features must fail explicitly**, not silently degrade unless documented

---

## Phase 1 — Worker Scaffold and Baseline Runtime

Set up a production-ready Cloudflare Worker skeleton.

### Deliverables
- TypeScript module Worker
- `wrangler.jsonc`
- `tsconfig.json`
- package scripts
- local dev entrypoint
- `/healthz` endpoint
- base error handler
- request ID injection

### Technical recommendations
- Use a current `compatibility_date`
- Enable `observability` in Wrangler config
- Use Wrangler secrets for upstream API keys
- Prefer direct `fetch()` to upstream APIs initially rather than large SDK dependencies
- Add `nodejs_compat` only if truly needed by chosen dependencies

### Suggested routes in this phase
- `GET /healthz`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

At this stage, routes can still return placeholder `501 Not Implemented` responses after validation scaffolding is added.

---

## Phase 2 — Canonical IR Design

Replace the current minimal `OmniRequest` idea with a richer and explicit IR.

### IR design principles
- Represent **instructions** separately from conversation turns
- Represent content as **typed blocks**, not `any`
- Preserve tool usage and tool results explicitly
- Keep provider-specific extensions in namespaced fields
- Model output controls independently from protocol-specific names
- Keep room for streaming state and partial deltas

### Suggested request IR

```ts
type ProviderHint = "openai" | "anthropic" | "auto"

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; argumentsJson: string }
  | { type: "tool_result"; toolCallId: string; result: string; isError?: boolean }
  | { type: "provider_extension"; provider: string; name: string; payload: unknown }

type NormalizedMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool"
  content: ContentBlock[]
  name?: string
}

type NormalizedTool = {
  type: "function"
  name: string
  description?: string
  inputSchema?: unknown
}

type ToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "tool"; name: string }

type NormalizedRequest = {
  targetModel: string
  providerHint?: ProviderHint
  instructions: ContentBlock[]
  messages: NormalizedMessage[]
  tools?: NormalizedTool[]
  toolChoice?: ToolChoice
  output?: {
    temperature?: number
    maxOutputTokens?: number
    stop?: string[]
    jsonSchema?: unknown
  }
  stream: boolean
  metadata?: Record<string, string>
  extensions?: {
    openai?: Record<string, unknown>
    anthropic?: Record<string, unknown>
  }
}
```

### Suggested result IR

```ts
type NormalizedResult = {
  model: string
  provider: "openai" | "anthropic"
  output: ContentBlock[]
  finishReason?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
  responseId?: string
  extensions?: Record<string, unknown>
}
```

### Why this is necessary
This structure is needed to faithfully represent:
- Anthropic `system` and block-based message shapes
- OpenAI Chat tool calls
- OpenAI Responses input/output item structures
- explicit tool call and tool result ordering

---

## Phase 3 — Validation, Error Taxonomy, and Feature Gating

Before provider integration, build a robust validation and error layer.

### Deliverables
- Zod schemas for each ingress protocol
- canonical error classes
- protocol-specific error rendering
- unsupported feature detection

### Error categories
- `ValidationError`
- `AuthenticationError`
- `AuthorizationError`
- `UnsupportedFeatureError`
- `ProviderSelectionError`
- `UpstreamAPIError`
- `StreamProtocolError`
- `TimeoutError`
- `InternalRelayError`

### Requirements
- Normalize errors internally
- Render errors outward in the format expected by the calling protocol where practical
- Reject unsupported features early, before upstream calls are made

### Example unsupported cases for MVP
- OpenAI built-in tools translated to Anthropic
- Anthropic thinking blocks guaranteed on OpenAI Chat egress
- multimodal file/image normalization across providers

---

## Phase 4 — Ingress Protocol Parsers

Implement request parsing into the canonical IR.

### Deliverables
- `protocols/openai-chat/parse.ts`
- `protocols/openai-responses/parse.ts`
- `protocols/anthropic-messages/parse.ts`

### Responsibilities

#### OpenAI Chat parser
- Parse `messages`
- Parse `tools`
- Parse `tool_choice`
- Parse `stream`
- Parse max token fields into normalized output config
- Extract assistant tool calls into normalized tool-call blocks

#### OpenAI Responses parser
- Parse `input`
- Parse instructions/system-like fields
- Parse tools and output format settings
- Normalize response-specific fields into IR
- Preserve response-only metadata under `extensions.openai`

#### Anthropic Messages parser
- Parse `system`
- Parse block-based `messages`
- Parse `tools`
- Parse tool choice semantics
- Normalize `tool_use` and `tool_result` blocks
- Preserve Anthropic-specific fields under `extensions.anthropic`

### Acceptance criteria
- Each parser has fixture-based tests
- Snapshot output of IR is deterministic
- Invalid payloads produce stable validation errors

---

## Phase 5 — Provider Routing and Capability Evaluation

Add routing logic that determines which upstream provider should receive the normalized request.

### Deliverables
- `core/routing.ts`
- `core/capabilities.ts`
- `core/feature-gates.ts`

### Routing rules
Order of precedence:
1. explicit `providerHint`
2. explicit model/provider mapping table
3. protocol-specific default behavior
4. fallback heuristic by model prefix/name

### Capability evaluator should answer
- Does this provider support this model?
- Does this provider support requested tools?
- Does this provider support requested stream mode?
- Does this provider support requested structured output mode?
- Is the requested cross-provider translation allowed in MVP?

### Output
Either:
- chosen provider + normalized request ready for adapter mapping, or
- explicit unsupported/provider-selection error

---

## Phase 6 — Provider Adapters

Implement outbound adapters for OpenAI and Anthropic.

### Adapter interface

```ts
interface ProviderAdapter {
  id: "openai" | "anthropic"
  supports(model: string, req: NormalizedRequest): boolean
  invoke(req: NormalizedRequest, env: Env): Promise<NormalizedResult>
  invokeStream(req: NormalizedRequest, env: Env): Promise<ReadableStream<NormalizedEvent>>
}
```

### OpenAI adapter
#### Recommendation
Use the **Responses API as the preferred OpenAI upstream target** where feasible for new normalized traffic, while still supporting Chat ingress at the relay edge.

### Deliverables
- `providers/openai/client.ts`
- `providers/openai/map-request.ts`
- `providers/openai/map-response.ts`
- `providers/openai/map-stream.ts`

### Anthropic adapter deliverables
- `providers/anthropic/client.ts`
- `providers/anthropic/map-request.ts`
- `providers/anthropic/map-response.ts`
- `providers/anthropic/map-stream.ts`

### Requirements
- Use streaming-friendly `fetch`
- Preserve status codes and provider error payload details for debugging
- Redact secrets from logs
- Map provider responses into canonical result/event types before egress rendering

---

## Phase 7 — Egress Renderers

Render normalized results back into the protocol expected by the incoming route.

### Deliverables
- `protocols/openai-chat/render.ts`
- `protocols/openai-responses/render.ts`
- `protocols/anthropic-messages/render.ts`

### Responsibilities

#### OpenAI Chat renderer
- Emit `chat.completion`-style payloads
- Render assistant content and tool calls into chat-compatible format
- Map usage and finish reason when available

#### OpenAI Responses renderer
- Emit response-item style structures
- Preserve response identifiers and structured output metadata when available
- Render normalized output blocks into responses-compatible items

#### Anthropic renderer
- Emit `messages` response shape
- Render content blocks including tool use where supported
- Map stop reason and usage fields

### Important rule
Document where translation is **lossy** or **unsupported**.

Examples:
- reasoning/thinking blocks may not round-trip faithfully
- provider-native tool metadata may not survive cross-provider translation
- response persistence/session features may not map across APIs

---

## Phase 8 — Streaming Engine

Implement streaming only after non-streaming paths are working.

### Internal normalized stream event model

```ts
type NormalizedEvent =
  | { type: "response_start"; model: string; provider: string }
  | { type: "message_start"; role: "assistant" }
  | { type: "content_delta"; deltaType: "text"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argumentsDelta: string }
  | { type: "tool_call_end"; id: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: "response_end"; finishReason?: string }
  | { type: "error"; message: string; retryable?: boolean }
```

### Deliverables
- SSE parser utilities
- upstream stream mappers for OpenAI and Anthropic
- protocol-specific stream re-emitters

### Requirements
- parse upstream streams incrementally
- do not materialize full streams in memory
- re-emit as protocol-appropriate event formats:
  - OpenAI chat chunks
  - OpenAI responses stream events
  - Anthropic event stream

### Edge/runtime requirements
- preserve backpressure correctly
- ensure proper `text/event-stream` headers
- handle upstream disconnects and partial stream failures cleanly

---

## Phase 9 — Authentication and Access Control

Add security after protocol correctness is stable.

### MVP auth
- one relay API key
- one OpenAI upstream key
- one Anthropic upstream key

### Deliverables
- bearer token validation for relay clients
- secret-backed upstream credential loading
- consistent auth error responses

### V1.1 extensions
- per-tenant relay API keys
- per-tenant provider credentials
- tenant-specific routing policy
- quotas and usage accounting
- optional JWT layer

---

## Phase 10 — Rate Limiting and Abuse Controls

### MVP
- simple API key-based throttling
- per-route limits if needed

### Implementation options
Prefer Cloudflare-native controls first. Only add KV/D1/DO-backed custom rate limiting if necessary for tenant-aware behavior.

### Deliverables
- rate-limit middleware
- consistent 429 responses
- optional route-sensitive throttling

---

## Phase 11 — Observability and Debugging

### Deliverables
- structured JSON logs
- request ID propagation
- latency timing
- upstream provider timing metrics
- debug translation endpoint

### Debug endpoint
`/v1/debug/translate`

This endpoint should:
- be admin-only
- redact secrets
- redact or truncate sensitive payloads where appropriate
- be disableable in production

### Logged fields
- request ID
- ingress protocol
- selected provider
- target model
- stream mode
- status code
- upstream latency
- total latency
- feature gate decision / rejection reason

---

## Phase 12 — Testing Strategy

Testing must be part of implementation, not an afterthought.

### Test categories

#### 1. Parser tests
- protocol payload → IR snapshot

#### 2. Renderer tests
- normalized result → protocol payload snapshot

#### 3. Provider adapter tests
- IR → upstream request shape
- upstream response → normalized result

#### 4. Golden translation tests
- Chat ingress → OpenAI upstream → Chat egress
- Chat ingress → Anthropic upstream → Chat egress
- Responses ingress → Anthropic upstream → Responses egress
- Anthropic ingress → OpenAI upstream → Anthropic egress

#### 5. Streaming tests
- text deltas
- tool call argument deltas
- stream abort mid-flight
- upstream error event handling

#### 6. Unsupported feature tests
- rejected provider-native tools cross-provider
- rejected unsupported reasoning normalization
- rejected unsupported multimodal payloads

### Tooling
- Vitest for unit/integration
- fixture snapshots for protocol examples
- mocked upstream SSE streams for streaming correctness

---

## Phase 13 — Deployment and Operations

### Deliverables
- production `wrangler.jsonc`
- secret setup instructions
- deploy script / npm script
- rollback notes
- environment split if needed (`staging`, `production`)

### Production checklist
- secrets set in Wrangler
- observability enabled
- health endpoint working
- rate limiting enabled
- logs reviewed in staging
- at least one end-to-end streaming test verified remotely

---

## Phase 14 — Post-MVP Extensions

Only after MVP is stable.

### Candidate follow-ups
- Gemini support
- Workers AI support
- OpenRouter support
- model aliasing
- provider failover routing
- cost-aware routing
- before/after transform hooks
- tenant admin config in KV/D1
- AI Gateway integration

---

## Recommended Milestones

## Milestone 1 — Skeleton + IR + validation
Deliver:
- Worker scaffold
- route structure
- canonical IR
- Zod schemas
- error taxonomy
- placeholder handlers

## Milestone 2 — Non-streaming MVP path
Deliver:
- OpenAI Chat ingress parser
- OpenAI Responses ingress parser
- Anthropic ingress parser
- OpenAI adapter
- Anthropic adapter
- non-streaming renderers

## Milestone 3 — Tool support
Deliver:
- custom function tool normalization
- tool choice normalization
- provider capability checks
- explicit unsupported feature handling

## Milestone 4 — Streaming
Deliver:
- normalized stream event model
- provider stream mappers
- protocol-specific stream re-emitters

## Milestone 5 — Security and operations
Deliver:
- relay auth
- rate limiting
- observability
- debug endpoint
- deploy readiness

## Milestone 6 — Extensions
Deliver any of:
- Gemini
- Workers AI
- OpenRouter
- failover
- cost routing

---

## Key Design Rules

1. **IR is the source of truth**
   - never build protocol-to-protocol pair translators as the main architecture

2. **Cross-provider support must be explicit**
   - if a feature is lossy or unsupported, return a clear error

3. **Streaming must stay incremental**
   - no buffering full SSE responses into memory

4. **Provider-native features stay provider-native unless deliberately normalized**
   - avoid fake compatibility claims

5. **Validation happens before provider routing**
   - reject invalid or unsupported requests early

6. **Observability is built in from the start**
   - request IDs, structured logs, redaction, latency

---

## Open Questions Requiring Product Decisions

These should be answered before implementation starts in earnest:

1. **Is Gemini actually part of MVP?**
   - `README.md` currently mentions Gemini, but the implementation plan does not

2. **Should provider-native tools be supported in MVP?**
   - recommendation: no, only custom function tools cross-provider in v1

3. **Single-tenant or multi-tenant first?**
   - recommendation: single-tenant first

4. **Should OpenAI upstream default to Responses API where possible?**
   - recommendation: yes

5. **Should unsupported features fail hard or degrade softly?**
   - recommendation: fail explicitly unless documented safe degradation exists

---

## Immediate Next Step

The best next implementation step is:

1. create Worker scaffold
2. write `docs/capabilities.md`
3. implement canonical IR types
4. add protocol schemas and parsers
5. get one non-streaming end-to-end path working first

Recommended first successful path:
- `POST /v1/chat/completions`
- parse to IR
- route to OpenAI
- render back to chat-completions response

Then expand to Responses and Anthropic.

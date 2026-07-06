# REFACTOR.md

# Omni Relay Refactoring & Architecture Roadmap

## Overview

This document describes the long-term refactoring plan for **omni-relay**.

The primary objective is **not** to become another HTTP reverse proxy, but to become a **protocol translation engine** capable of transparently converting requests and responses among:

* OpenAI API
* Anthropic Claude API
* Google Gemini API
* GLM API
* Kimi API
* OpenRouter
* Local models (Ollama, LM Studio, etc.)
* Future providers

The design should prioritize:

* Extensibility
* Minimal code duplication
* Provider independence
* Stream-first architecture
* Testability
* Cloudflare Worker compatibility

---

# Current Problems

Current implementation has several architectural issues.

## 1. Endpoint-specific logic

Current flow resembles:

```
HTTP Request

↓

if endpoint == ...

↓

Provider Request

↓

Response
```

Each endpoint performs its own translation.

Problems:

* duplicated code
* difficult to add providers
* difficult to maintain
* N × M translation explosion

---

## 2. Streaming tied to providers

Current stream processing mixes:

* provider parsing
* HTTP writing
* SSE formatting

This makes adding another provider extremely difficult.

---

## 3. Provider-specific objects everywhere

Current code contains provider-specific request/response objects throughout the project.

Example:

```
OpenAIRequest

ClaudeRequest

GeminiRequest

...
```

instead of one internal model.

---

## 4. Missing normalization layer

Every provider uses different names.

Examples

```
max_tokens

max_completion_tokens

max_output_tokens
```

```
system

instruction

messages[0]
```

```
tools

functions

functionDeclarations
```

Translation should happen once.

---

# Refactoring Goals

The new architecture should look like

```
Incoming HTTP

↓

Inbound Translator

↓

Canonical Request

↓

Provider Adapter

↓

Provider HTTP

↓

Provider Response

↓

Canonical Response

↓

Outbound Translator

↓

HTTP Response
```

Every provider becomes just another adapter.

---

# Phase 1 – Introduce Canonical Models

Priority:
⭐⭐⭐⭐⭐

Create a canonical protocol independent of any provider.

Suggested directory

```
src/

    canonical/

        request.ts

        response.ts

        stream.ts

        tool.ts

        error.ts
```

Example

```ts
export interface CanonicalRequest {

    provider?: string

    model: string

    messages: ChatMessage[]

    system?: string

    temperature?: number

    topP?: number

    maxTokens?: number

    stream: boolean

    tools?: CanonicalTool[]

    metadata?: Record<string, unknown>

}
```

Benefits

* one internal language
* providers become translators
* easy testing

Deliverables

* CanonicalRequest
* CanonicalResponse
* CanonicalTool
* CanonicalStreamEvent
* CanonicalError

---

# Phase 2 – Endpoint Translation Layer

Priority:
⭐⭐⭐⭐⭐

Create inbound translators.

Suggested layout

```
translators/

    inbound/

        openai.ts

        anthropic.ts

        gemini.ts

        responses.ts

        chat.ts
```

Each translator converts

```
Incoming JSON

↓

CanonicalRequest
```

No provider code should exist here.

Example

```
POST /v1/chat/completions

↓

CanonicalRequest
```

Deliverables

* remove endpoint-specific business logic
* parser-only translators

---

# Phase 3 – Provider Adapters

Priority:
⭐⭐⭐⭐⭐

Provider adapters convert CanonicalRequest into provider requests.

Layout

```
providers/

    openai/

    anthropic/

    gemini/

    glm/

    kimi/

    openrouter/

    ollama/
```

Each provider exports

```
translateRequest()

translateResponse()

streamParser()

capabilities()
```

Provider adapters should never inspect HTTP paths.

---

# Phase 4 – Stream Normalization

Priority:
⭐⭐⭐⭐⭐

Streaming should become provider-independent.

Instead of

```
Provider

↓

write(res)
```

Create

```
Provider

↓

Provider Stream Parser

↓

Canonical Stream Events

↓

Stream Writer

↓

HTTP
```

Canonical stream events

```
TextDelta

ToolCallDelta

ToolResult

Usage

Error

Finish
```

Example

Claude

```
content_block_delta
```

↓

```
TextDelta
```

Gemini

↓

```
TextDelta
```

OpenAI

↓

```
TextDelta
```

Benefits

Every provider shares one stream pipeline.

---

# Phase 5 – Stream Writers

Priority:
⭐⭐⭐⭐⭐

Introduce stream writers.

```
stream/

    writers/

        openai.ts

        anthropic.ts

        gemini.ts
```

Example interface

```ts
interface StreamWriter {

    start()

    delta()

    tool()

    usage()

    finish()

    error()

}
```

Never call

```
res.write(...)
```

directly from provider code.

---

# Phase 6 – Response Normalization

Current

```
Provider JSON

↓

HTTP
```

New

```
Provider JSON

↓

CanonicalResponse

↓

Outbound Formatter

↓

HTTP
```

Benefits

* unified usage
* unified finish reasons
* unified tool outputs

---

# Phase 7 – Capability Registry

Instead of

```
if provider == "Claude"
```

Create

```
registry/

    capabilities.ts
```

Example

```ts
{
    streaming: true,

    vision: true,

    reasoning: false,

    jsonMode: true,

    tools: true,

    imageInput: true,

    imageOutput: false,

    maxContext: 200000
}
```

Routing becomes capability-based.

---

# Phase 8 – Endpoint Registry

Replace

```
switch(pathname)
```

with

```
registerEndpoint({

    endpoint:

    translator:

    formatter:

})
```

Example

```
/v1/chat/completions

↓

OpenAI Translator
```

```
/v1/messages

↓

Anthropic Translator
```

This makes adding endpoints almost configuration-only.

---

# Phase 9 – Unified Error Handling

Current

```
Provider Error

↓

HTTP
```

New

```
Provider Error

↓

CanonicalError

↓

Formatter

↓

HTTP
```

Suggested CanonicalError

```ts
interface CanonicalError {

    code: string

    message: string

    retryable: boolean

    provider?: string

}
```

---

# Phase 10 – Middleware Pipeline

Suggested execution flow

```
Request

↓

Logger

↓

Authentication

↓

Rate Limit

↓

Endpoint Registry

↓

Inbound Translator

↓

Canonical Request

↓

Router

↓

Provider Adapter

↓

HTTP Client

↓

Response Parser

↓

Canonical Response

↓

Formatter

↓

HTTP Response
```

Each middleware has only one responsibility.

---

# Phase 11 – Routing Engine

Future routing should support

* provider fallback
* weighted routing
* latency routing
* cost routing
* capability routing
* health checks

Example

```
Claude

↓

Unavailable

↓

Gemini

↓

Unavailable

↓

GLM

↓

Success
```

---

# Phase 12 – Testing Strategy

## Unit Tests

Test every translator independently.

```
OpenAI JSON

↓

CanonicalRequest
```

```
Claude JSON

↓

CanonicalRequest
```

---

## Stream Tests

Replay recorded SSE streams.

Verify

```
Provider Stream

↓

Canonical Events
```

---

## Golden Tests

Store

```
input.json

↓

expected.json
```

Verify every translator.

---

## Integration Tests

Mock providers.

Verify

```
HTTP

↓

Canonical

↓

Provider

↓

Canonical

↓

HTTP
```

---

# Recommended Project Structure

```
src/

    canonical/

        request.ts
        response.ts
        stream.ts
        tool.ts
        error.ts

    translators/

        inbound/
        outbound/

    providers/

        openai/
        anthropic/
        gemini/
        glm/
        kimi/
        openrouter/
        ollama/

    stream/

        parser.ts
        writers/

    registry/

        endpoint.ts
        capability.ts

    middleware/

    routing/

    http/

    utils/

tests/

docs/

examples/
```

---

# Implementation Order

## Milestone 1

* CanonicalRequest
* CanonicalResponse
* CanonicalTool
* CanonicalError

Expected outcome

Stable internal protocol.

---

## Milestone 2

* OpenAI inbound translator
* Claude inbound translator

Expected outcome

Both APIs produce identical CanonicalRequest objects.

---

## Milestone 3

* Provider adapters
* Request normalization
* Response normalization

Expected outcome

Multiple providers can execute the same CanonicalRequest.

---

## Milestone 4

* Canonical stream events
* Stream parser
* Stream writers

Expected outcome

All providers share one streaming pipeline.

---

## Milestone 5

* Endpoint registry
* Capability registry
* Routing engine

Expected outcome

Provider selection becomes dynamic.

---

## Milestone 6

* Middleware pipeline
* Retry
* Failover
* Health checks
* Metrics

Expected outcome

Production-ready architecture.

---

# Future Enhancements

After the core refactor is complete, the following features become much easier to implement:

* OpenAI Responses API compatibility
* Multi-modal (image/audio/video) support
* Model Context Protocol (MCP) integration
* Prompt caching and semantic routing
* Request batching
* Distributed rate limiting
* Token usage accounting
* Provider-specific optimizations
* WebSocket streaming
* Bidirectional tool execution
* Workflow orchestration
* Pluggable authentication (API keys, OAuth, JWT)
* Observability (OpenTelemetry, structured logging, tracing)
* Configuration-driven provider registration

---

# Reference Projects

The following open-source projects provide valuable implementation patterns and should be used as references during development.

## Primary References

* Omni Relay (this project)
* CLIProxyAPI
* cc-switch

## Additional References

* LiteLLM (Python)
* cc-relay (Go)
* OpenRouter ecosystem
* Ollama API implementation

Each project demonstrates strengths in different areas:

| Project     | Reference Focus                                                            |
| ----------- | -------------------------------------------------------------------------- |
| CLIProxyAPI | Protocol translation, provider adapters, robust SSE handling               |
| cc-switch   | Routing, account/provider switching, TypeScript architecture               |
| LiteLLM     | Canonical request/response modeling across many providers                  |
| cc-relay    | Clean streaming implementation, provider failover, Go concurrency patterns |
| OpenRouter  | Model abstraction, provider aggregation, compatibility layers              |

The recommended approach is to adopt proven architectural ideas rather than copying implementations verbatim, ensuring Omni Relay remains lightweight, extensible, and optimized for Cloudflare Workers while benefiting from mature design patterns established by these projects.

---

# Current Phase Priority: OpenAI-Compatible + Anthropic-Compatible Upstreams Only

For the **next implementation phase**, Omni Relay should stay tightly scoped:

## In scope now

* OpenAI-style ingress:
  * `/v1/chat/completions`
  * `/v1/responses`
* Anthropic-style ingress:
  * `/v1/messages`
* Upstream targets:
  * **OpenAI-compatible upstreams only**
  * **Anthropic-compatible upstreams only**
* Streaming and non-streaming parity for those routes
* Tool-call parity needed by:
  * **Codex CLI**
  * **Claude CLI**

## Explicitly not in scope for this phase

Do **not** expand the refactor around Gemini / Ollama / OpenRouter-native / local model provider support yet.

Those providers can still fit the long-term architecture, but they should not drive the current refactor shape.

The current phase should optimize for:

1. OpenAI client ↔ OpenAI-compatible upstream
2. OpenAI client ↔ Anthropic-compatible upstream
3. Anthropic client ↔ Anthropic-compatible upstream
4. Anthropic client ↔ OpenAI-compatible upstream

If a design choice makes those 4 flows simpler and more robust, prefer it over a more abstract but wider future-facing design.

---

# Architecture Recommendation for the Current Repo

The repo already contains the beginnings of a canonical IR in:

* `src/core/ir.ts`
* `src/core/stream-events.ts`
* `src/core/feature-gates.ts`
* `src/providers/*`
* `src/protocols/*`

So the recommended path is **incremental refactor**, not a rewrite.

## Important rule

Do **not** stop the project and rebuild from scratch into a brand-new folder tree.

Instead:

* preserve working behavior
* preserve deployed routes
* preserve current tests
* extract boundaries gradually

This avoids breaking the client-compatibility work already verified for Codex CLI and Claude CLI.

---

# Recommended Refactor Shape

## Step 1 — Formalize the existing IR as Canonical Models

Keep the current `core/ir.ts` semantics, but move toward a clearer canonical layer.

Recommended target:

```
src/canonical/
  request.ts
  response.ts
  stream.ts
  tool.ts
  error.ts
```

Practical migration rule:

* `src/core/ir.ts` becomes the source for `CanonicalRequest`, `CanonicalResponse`, `CanonicalTool`
* `src/core/stream-events.ts` becomes the source for `CanonicalStreamEvent`
* provider adapters and protocol handlers should depend on canonical types, not on each other

### What to normalize now

For the current phase, the canonical request/response model only needs to cover:

* `model`
* `providerHint`
* `instructions`
* `messages`
* `tool calls`
* `tool results`
* `stream`
* `temperature`
* `maxOutputTokens`
* `stop`
* `metadata`
* provider-native extension buckets

This is enough for OpenAI-compatible and Anthropic-compatible translation without overdesigning for future providers.

---

## Step 2 — Split “HTTP route handler” from “inbound translator”

Current route handlers still combine:

* auth
* body parsing
* protocol normalization
* provider selection
* upstream execution
* response rendering

Refactor toward:

```
route handler
  -> auth / rate limit / request metadata
  -> inbound translator
  -> canonical request
  -> provider router
  -> provider adapter
  -> canonical response / canonical stream
  -> outbound formatter
```

### Recommended current-phase translator split

```
src/translators/inbound/
  openai-chat.ts
  openai-responses.ts
  anthropic-messages.ts
```

These should contain only:

* schema validation
* request normalization
* no fetch logic
* no response rendering

Current code that should move there over time:

* `src/protocols/openai-chat/parse.ts`
* `src/protocols/openai-responses/parse.ts`
* `src/protocols/anthropic-messages/parse.ts`

---

## Step 3 — Separate outbound formatters from provider adapters

Current structure is close, but still mixed in places.

The correct dependency direction should be:

* inbound translator → canonical request
* provider adapter → canonical response/events
* outbound formatter → client-specific HTTP JSON/SSE

Recommended target:

```
src/translators/outbound/
  openai-chat.ts
  openai-responses.ts
  anthropic-messages.ts
```

Current code that should gradually move there:

* `src/protocols/openai-chat/render.ts`
* `src/protocols/openai-chat/stream.ts`
* `src/protocols/openai-responses/render.ts`
* `src/protocols/openai-responses/stream.ts`
* `src/protocols/anthropic-messages/render.ts`
* `src/protocols/anthropic-messages/stream.ts`

---

## Step 4 — Introduce a strict provider adapter contract

For this phase, only two provider adapter families are needed:

* `openai-compatible`
* `anthropic-compatible`

Not “OpenAI the company” vs “Anthropic the company”.

That distinction matters because the real upstreams for this project are BigModel-compatible endpoints, not the official vendors.

### Proposed adapter interface

```ts
interface ProviderAdapter {
  kind: 'openai-compatible' | 'anthropic-compatible'
  translateRequest(request: CanonicalRequest): unknown
  parseResponse(payload: unknown): CanonicalResponse
  parseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<CanonicalStreamEvent>
  capabilities(): ProviderCapabilities
}
```

### Why this matters now

It keeps the architecture aligned with the real problem:

* protocol translation
* not vendor-brand translation

---

## Step 5 — Build one canonical stream pipeline

This is the highest-leverage refactor after the canonical request model.

The current stream code already hints at a shared model, but the next phase should make it explicit.

Recommended canonical stream event set for the current scope:

```ts
type CanonicalStreamEvent =
  | { type: 'response_start'; model: string; provider: string }
  | { type: 'message_start'; role: 'assistant' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; toolType?: 'function' | 'custom' }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'response_end'; finishReason?: string }
  | { type: 'error'; code: string; message: string }
```

### Current-phase requirement

The stream pipeline must preserve the event ordering that real clients depend on:

* Codex CLI via OpenAI Responses streaming
* Claude CLI via Anthropic Messages streaming

That means real captured client traces should drive the tests.

---

## Step 6 — Introduce endpoint registry after translator extraction

Do **not** make endpoint registration the first refactor.

It becomes valuable only after inbound/outbound translator boundaries are clean.

Recommended shape:

```ts
registerEndpoint({
  path: '/v1/responses',
  protocol: 'openai-responses',
  inboundTranslator,
  outboundFormatter,
})
```

For the current phase, only register:

* `/v1/chat/completions`
* `/v1/responses`
* `/v1/messages`
* `/healthz`
* `/v1/debug/translate`

---

# What to Borrow from the Reference Projects

## From CLIProxyAPI

Adopt:

* config-driven provider definitions
* reusable translation/routing layers
* robust compatibility focus across CLI clients
* SSE handling discipline

Do **not** adopt:

* broad provider sprawl in the current phase
* management-center complexity before translation boundaries are stable

Why it matters:

CLIProxyAPI demonstrates that client compatibility work becomes much easier when protocol conversion and provider configuration are reusable layers rather than endpoint-specific code paths.

## From CC Switch

Adopt:

* request-format conversion as a first-class local routing concern
* app/client compatibility as a design target
* failover/logging as layers around translation rather than mixed into it

Why it matters:

CC Switch explicitly treats local routing as:

* request conversion
* provider selection
* logging / usage
* failover

That separation is exactly the right shape for Omni Relay’s next phase.

## From LiteLLM

Adopt:

* canonical request/response normalization
* exception mapping into one consistent error surface
* capability and endpoint breadth as a reason to keep adapters thin

Do **not** adopt:

* multi-tenant gateway complexity yet
* budgets / spend / admin abstractions yet

Why it matters:

LiteLLM shows the value of making the internal contract stable even when providers differ.

## From cc-relay

Adopt:

* explicit server/config bootstrap
* health + model-listing verification habits
* clear provider config and testing workflow for Claude-compatible routing

Why it matters:

cc-relay is closer to the current project scope than a general AI gateway because it is optimized around coding-tool compatibility and proxy operation.

---

# Concrete Current-Phase Milestones

## Milestone A — Stabilize current compatibility surface

Goal:

Make the current three ingress routes fully client-compatible before moving files around.

Checklist:

* complete real-client parity for:
  * Codex CLI → `/v1/responses`
  * Claude CLI → `/v1/messages`
* preserve:
  * tool-call roundtrips
  * multi-turn transcripts
  * streaming event ordering
  * auth header compatibility
  * query parameter pass-through (e.g. `?beta=true`)
* add regression fixtures from captured real requests

## Milestone B — Extract inbound translators

Goal:

Move request parsing/normalization into standalone modules with no fetch logic.

Checklist:

* create `src/translators/inbound/`
* migrate current parse logic there
* make route handlers depend only on translator interfaces
* preserve existing tests while adding golden translation tests

## Milestone C — Extract outbound formatters + stream writers

Goal:

Make client-facing JSON/SSE rendering independent from provider adapters.

Checklist:

* create `src/translators/outbound/`
* create `src/stream/writers/`
* convert protocol stream renderers into shared writer-based flow
* add ordering tests for Codex and Claude client traces

## Milestone D — Introduce provider adapter registry

Goal:

Treat OpenAI-compatible and Anthropic-compatible upstreams as adapter kinds rather than route-specific special cases.

Checklist:

* define adapter interface
* register `openai-compatible`
* register `anthropic-compatible`
* route by provider kind + capabilities
* keep provider selection independent from HTTP path

## Milestone E — Add capability + endpoint registries

Goal:

Reduce route branching and provider branching boilerplate.

Checklist:

* endpoint registration instead of hard-coded path switches
* capability registry instead of scattered conditionals
* centralized unsupported-feature decisions

## Milestone F — Add models and metadata surface

Goal:

Support client ecosystems that expect model discovery and cleaner compatibility metadata.

Checklist:

* implement `/v1/models` for the active configured upstream families
* normalize enough model metadata for OpenAI-compatible clients
* keep model listing limited to current configured upstreams

---

# Recommended Immediate Next Implementation Tasks

If implementation starts from the current codebase today, the best next sequence is:

1. **Finish and commit the currently in-progress Codex/Claude compatibility fixes**
2. Add **captured real-client fixture tests**
   * Codex `/v1/responses`
   * Claude `/v1/messages?beta=true`
3. Extract **inbound translators** without changing behavior
4. Introduce **canonical response + canonical error** types
5. Extract **outbound formatters**
6. Introduce **provider adapter interfaces**
7. Then add **endpoint/capability registries**

This order keeps the refactor grounded in the client behavior already proven to matter.


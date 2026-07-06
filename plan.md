# omni-relay — Implementation Plan

## Overview
omni-relay is a Cloudflare Workers–based universal LLM API relay and protocol translator supporting:
- OpenAI Chat Completions
- OpenAI Responses (Codex)
- Anthropic Messages

It normalizes all APIs into a canonical intermediate representation (IR), then routes to provider adapters.

---

## Phase 0 — Architecture Design (Core IR)

Define a canonical request model:

```ts
type OmniRequest = {
  model: string
  messages: { role: string; content: any }[]
  tools?: any[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  providerHint?: "openai" | "anthropic" | "auto"
}
```

Response abstraction:
- OpenAI Chat format
- OpenAI Responses format
- Anthropic Messages format

---

## Phase 1 — Cloudflare Worker Skeleton

Borrow from:
- llm-relay (Hono-based Worker structure)
- cloudflare-ai-proxy (routing patterns)

Routes:
- POST /v1/chat/completions
- POST /v1/messages
- POST /v1/responses

Basic routing:
- path → handler → provider adapter

---

## Phase 2 — OpenAI Adapter Layer

Supports:
- Chat Completions
- Responses API (Codex)

Key tasks:
- responses → chat conversion
- chat → responses mapping
- tool call normalization

---

## Phase 3 — Anthropic Adapter

Borrow from claude-code-proxy patterns.

Translate:
- Anthropic Messages → OmniRequest
- OmniRequest → Anthropic Messages

Handle:
- tool_use blocks
- system prompts
- streaming SSE events

---

## Phase 4 — Protocol Translation Layer

Core innovation:

Bidirectional translation matrix:
- Responses ↔ Chat
- Messages ↔ Chat
- Messages ↔ Responses

Normalize:
- tool calling
- streaming
- message roles
- reasoning blocks

---

## Phase 5 — Provider Abstraction Layer

Interface:
```ts
interface Provider {
  chat(req: OmniRequest): Promise<any>
  stream(req: OmniRequest): AsyncIterable<any>
}
```

Providers:
- OpenAI
- Anthropic
- Workers AI
- OpenRouter (optional)

Routing:
- model-based selection
- provider hints override

---

## Phase 6 — Streaming Engine

Normalize streaming into:
- delta
- tool_call
- done

Then re-emit as:
- OpenAI SSE
- Anthropic event stream
- Responses stream

---

## Phase 7 — Auth Layer

Features:
- API key auth
- rate limiting
- optional JWT
- multi-tenant support

---

## Phase 8 — Observability

Add:
- request tracing
- latency logs
- debug endpoint /v1/debug/translate

---

## Phase 9 — Deployment (Cloudflare Workers)

Based on:
- llm-relay deployment pattern
- openai-workers-relay template

Includes:
- wrangler config
- edge streaming support

---

## Phase 10 — Advanced Features

Optional enhancements:
- model aliasing
- failover routing
- cost-aware routing
- request hooks (before/after transform)

---

## Final Architecture

Codex CLI → /v1/responses  
Claude CLI → /v1/messages  
OpenAI SDK → /v1/chat/completions  

All routes:
→ omni-relay Worker
→ canonical IR
→ provider adapters
→ upstream APIs

---

## Outcome

A unified LLM protocol translation gateway running on Cloudflare Workers.


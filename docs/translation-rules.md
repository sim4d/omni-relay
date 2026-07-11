# Translation Rules & Field Coverage

How `omni-relay` translates between OpenAI Chat Completions, OpenAI Responses,
and Anthropic Messages, and which fields survive each boundary.

The relay uses a **hub-and-spoke IR** (`src/core/ir.ts`): every ingress parser
normalizes into the IR, and every provider mapper renders the IR back out.
There are no pairwise protocol translators. The consequence: **a field that the
IR does not model is lost** unless it is captured into a per-provider
`extensions.<provider>` bag and echoed back on the same-provider path.

## Field coverage matrix

| Field | Cross-provider (normalized) | Same-provider passthrough | Notes |
|-------|-----------------------------|---------------------------|-------|
| text content | ✅ | ✅ | text blocks |
| tool definitions | ✅ (function shape) | ✅ | nameless built-in tools (web_search) dropped |
| tool_choice | ✅ | ✅ | auto/none/required/tool |
| tool calls + results | ✅ | ✅ | id/call_id split preserved (Responses) |
| parallel_tool_calls | ✅ (IR flag) | ✅ | forwarded to OpenAI-family upstreams |
| reasoning_effort / thinking | ✅ | ✅ | see Reasoning below |
| top_p | ✅ | ✅ | |
| temperature, max_tokens, stop | ✅ | ✅ | |
| images / documents | ✅ | ✅ | see Multimodal below |
| cache_control (Anthropic) | ✅ (text blocks) | ✅ | cache breakpoint preserved end-to-end |
| usage incl. cache/reasoning tokens | ✅ | ✅ | prompt_tokens_details, cache_read/creation |
| streaming usage (include_usage) | ✅ | ✅ | terminal usage chunk emitted |
| metadata | ✅ | ✅ | |
| response_format (structured output) | ❌ same-provider only | ✅ | see Structured output below |
| previous_response_id / store | ❌ unsupported | ✅ passthrough | see Stateful Responses below |
| service_tier, user, seed, logprobs, n, frequency/presence_penalty | ❌ dropped cross-provider | ✅ passthrough | unmapped fields bag |

Legend: **cross-provider** = IR actively translates it so the other vendor's
upstream understands it. **same-provider passthrough** = the field survives a
Responses→Responses or Messages→Messages round-trip via the extensions bag but
is not translated to the other vendor.

## Reasoning / thinking

The IR carries a single `reasoning` config that normalizes three vendor shapes:

- OpenAI Chat `reasoning_effort` ("minimal"…"xhigh", "auto", "none")
- OpenAI Responses `reasoning.effort` / `reasoning.exclude`
- Anthropic `thinking` (`{type:'enabled', budget_tokens}` / `{type:'disabled'}` / `{type:'adaptive'}`)

Mapping happens in `src/core/reasoning.ts`. Anthropic's `enabled` mode requires
a token budget; when the source carried only an effort level, the relay
estimates a budget via `effortToBudget`. Streaming reasoning is carried as a
`reasoning_delta` normalized event and rendered as OpenAI `reasoning_content`
deltas, Anthropic `thinking_delta`/`signature_delta`, or Responses
`reasoning_summary_text` deltas.

Anthropic `redacted_thinking` blocks round-trip verbatim on the Anthropic path
(via a provider extension) and are dropped on the OpenAI path (no equivalent).

## Multimodal (images & documents)

OpenAI `image_url` / `input_image` and Anthropic `image` blocks translate to an
IR `image` block and back. Data URLs become base64 sources; HTTP URLs become
`source.type:'url'`. Documents (PDF, etc.) translate between OpenAI `input_file`
and Anthropic `document`. Helpers live in `src/core/content.ts`.

## Structured output (json_schema) — P2-A7 stance

**Same-provider only.** The relay does **not** translate json_schema structured
output across vendors. Concretely:

- OpenAI Chat `response_format` and OpenAI Responses `text.format` pass through
  unchanged on the OpenAI→OpenAI path (captured in `extensions.openai`).
- An OpenAI `response_format` arriving on an Anthropic-selected route is
  **dropped** (not translated to a forced tool call). Clients that require
  guaranteed structured output should target a same-provider upstream.
- The `feature-gates` layer rejects OpenAI Responses `text` config on any
  non-Responses-same-provider path with an explicit `UnsupportedFeatureError`.

Cross-provider structured output (map json_schema → a forced single-tool call
on Anthropic) is a documented future enhancement, not current behavior.

## Stateful Responses (`previous_response_id`, `store`) — P2-B4 stance

**Stateless replay only.** The relay treats `/v1/responses` as stateless: it
does not maintain server-side conversation state and does not resolve
`previous_response_id`. This is correct for the primary target clients (Codex
CLI, Claude CLI) which send the full conversation `input` array each turn
(stateless replay) rather than relying on `previous_response_id`.

- On the Responses→Responses same-provider path, `previous_response_id`,
  `store`, and `conversation_id` pass through unchanged via the unmapped-fields
  bag (the upstream may honor them).
- On any cross-provider path, these fields are dropped because there is no
  IR representation and the other vendor has no equivalent.

Clients that depend on `previous_response_id` resolution must use a
Responses-speaking upstream.

## Provider-native passthrough (P2-B7)

Fields the IR does not model (`user`, `seed`, `logprobs`, `n`,
`service_tier`, `frequency_penalty`, `presence_penalty`, and vendor-specific
fields) are captured into `extensions.<provider>.unmappedRequestFields` on
ingress and echoed back on the same-provider path. They are intentionally
**dropped cross-provider** — silently inventing a translation would be worse
than dropping. The lossiness-contract test (`tests/unit/lossiness-contract.test.ts`)
guards against future silent regressions by asserting every known ingress field
is accounted for.

## Known limitations

- **In-stream upstream errors are not surfaced as error frames.** If the
  upstream errors *after* the relay has begun streaming a response (e.g. a
  malformed SSE chunk mid-stream), the stream closes without an explicit
  `error` event / terminal frame. Clients see a truncated stream. This is
  pre-existing behavior; a future enhancement would catch iterator errors in
  `iterableToSSEStream` (`src/lib/sse.ts`) and emit a protocol-appropriate
  terminal error frame before closing.

export type ProviderId = 'openai' | 'anthropic'
export type ProviderHint = ProviderId | 'auto'

export type UpstreamKind = 'openai' | 'anthropic'

export type WireApi = 'chat_completions' | 'responses'

// A fully-resolved upstream target. One Worker may declare many of these; the
// request is routed to exactly one by matching `targetModel` against
// `modelGlobs`. Auth is kind-specific: `apiKey` for OpenAI-compatible targets
// (sent as `Authorization: Bearer`), `authToken` for Anthropic-compatible
// gateways (also Bearer). `wireApi` selects the OpenAI wire format.
export type UpstreamTarget = {
  slot: number                          // 1-based index, stable within a kind
  kind: UpstreamKind
  baseUrl: string                       // normalized, no trailing slash
  apiKey?: string                       // openai
  authToken?: string                    // anthropic
  wireApi?: WireApi                     // openai only; defaults to 'chat_completions'
  modelGlobs: string[]                  // lowercase glob patterns, e.g. ['gpt-*','glm-4*']
}

export type UpstreamTargetsConfig = {
  openai: UpstreamTarget[]
  anthropic: UpstreamTarget[]
}

/**
 * Normalized reasoning/thinking configuration carried on the request. This is
 * the cross-provider abstraction over OpenAI `reasoning_effort` and Anthropic
 * `thinking`. Providers map to/from their native shape at each boundary.
 *
 * - `effort` is the canonical level name: 'minimal' | 'low' | 'medium' |
 *   'high' | 'xhigh' | 'auto' | 'none'. OpenAI maps directly; Anthropic maps
 *   via budget/adaptive rules.
 * - `budgetTokens` carries an explicit token budget when the client specified
 *   one (Anthropic `thinking.budget_tokens`).
 * - `enabled: false` explicitly disables reasoning.
 */
export type ReasoningConfig = {
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto' | 'none'
  budgetTokens?: number
  enabled?: boolean
}

export type ProviderExtensionBlock = {
  type: 'provider_extension'
  provider: string
  name: string
  payload: unknown
}

export type TextContentBlock = {
  type: 'text'
  text: string
  cacheControl?: CacheControlMarker
}

/**
 * A reasoning/thinking content block. `signature` carries Anthropic's
 * redacted_thinking signature when present (needed for round-trip on the
 * Anthropic path).
 */
export type ReasoningContentBlock = {
  type: 'reasoning'
  text: string
  signature?: string
}

export type ImageContentBlock = {
  type: 'image'
  /** media type, e.g. 'image/png' */
  mediaType?: string
  /** base64-encoded data (when source is inline) */
  data?: string
  /** remote URL (when source is a URL) */
  url?: string
}

export type DocumentContentBlock = {
  type: 'document'
  mediaType?: string
  data?: string
  url?: string
}

export type ToolCallContentBlock = {
  type: 'tool_call'
  /**
   * Item identifier. On the OpenAI Responses API this is the function_call
   * item `id` (e.g. `fc_*`); on Chat it is the tool_call `id`; on Anthropic it
   * is the tool_use `id`.
   */
  id: string
  /**
   * Correlation id used to match tool results. On Responses this is `call_id`.
   * Defaults to `id` when the upstream does not distinguish the two.
   */
  callId?: string
  name: string
  argumentsJson: string
}

export type ToolResultContentBlock = {
  type: 'tool_result'
  toolCallId: string
  /**
   * Plain-text result. Always populated (stringified when the source was
   * structured) so downstream providers that only accept strings still work.
   */
  result: string
  /**
   * Structured content when the tool result carried multiple typed blocks
   * (Anthropic tool_result.content array, or rich OpenAI tool message
   * content). Preserved for same-provider round-trips; `result` is the
   * flattened fallback.
   */
  content?: ContentBlock[]
  isError?: boolean
}

/**
 * Anthropic prompt-caching breakpoint marker. Preserved end-to-end on the
 * Anthropic path so cache breakpoints survive ingress→egress.
 */
export type CacheControlMarker = {
  type: 'ephemeral'
  ttl?: '5m' | '1h'
}

export type ContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ImageContentBlock
  | DocumentContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock
  | ProviderExtensionBlock

export type MessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

export type NormalizedMessage = {
  role: MessageRole
  content: ContentBlock[]
  name?: string
}

export type NormalizedTool = {
  type: 'function'
  name: string
  description?: string
  inputSchema?: unknown
}

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'none' }
  | { type: 'required' }
  | { type: 'tool'; name: string; toolType?: 'function' | 'custom' }

export type OutputControls = {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stop?: string[]
  jsonSchema?: unknown
}

export type NormalizedRequest = {
  targetModel: string
  providerHint?: ProviderHint
  targetSlot?: number
  instructions: ContentBlock[]
  messages: NormalizedMessage[]
  tools?: NormalizedTool[]
  toolChoice?: ToolChoice
  output?: OutputControls
  /** Cross-provider reasoning/thinking configuration. */
  reasoning?: ReasoningConfig
  /** Whether the upstream may issue tool calls in parallel. */
  parallelToolCalls?: boolean
  stream: boolean
  /** Whether the client requested usage in the stream (OpenAI include_usage). */
  streamIncludeUsage?: boolean
  metadata?: Record<string, string>
  extensions?: {
    openai?: Record<string, unknown>
    anthropic?: Record<string, unknown>
  }
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  reasoningTokens?: number
}

export type NormalizedResult = {
  model: string
  provider: ProviderId
  output: ContentBlock[]
  finishReason?: string
  usage?: Usage
  responseId?: string
  extensions?: Record<string, unknown>
}

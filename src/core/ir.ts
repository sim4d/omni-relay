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

export type ProviderExtensionBlock = {
  type: 'provider_extension'
  provider: string
  name: string
  payload: unknown
}

export type TextContentBlock = {
  type: 'text'
  text: string
}

export type ToolCallContentBlock = {
  type: 'tool_call'
  id: string
  name: string
  argumentsJson: string
}

export type ToolResultContentBlock = {
  type: 'tool_result'
  toolCallId: string
  result: string
  isError?: boolean
}

export type ContentBlock =
  | TextContentBlock
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
  stream: boolean
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

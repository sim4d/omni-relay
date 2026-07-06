export type ProviderId = 'openai' | 'anthropic'
export type ProviderHint = ProviderId | 'auto'

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
  | { type: 'tool'; name: string }

export type OutputControls = {
  temperature?: number
  maxOutputTokens?: number
  stop?: string[]
  jsonSchema?: unknown
}

export type NormalizedRequest = {
  targetModel: string
  providerHint?: ProviderHint
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

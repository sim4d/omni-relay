import type { ProviderId, Usage } from './ir'

export type NormalizedEvent =
  | { type: 'response_start'; model: string; provider: ProviderId }
  | { type: 'message_start'; role: 'assistant' }
  | { type: 'content_delta'; deltaType: 'text'; text: string }
  | { type: 'tool_call_start'; id: string; name: string; toolType?: 'function' | 'custom'; callId?: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; usage: Usage }
  | { type: 'response_end'; finishReason?: string }
  | { type: 'error'; message: string; retryable?: boolean }

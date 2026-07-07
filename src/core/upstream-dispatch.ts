import { ValidationError } from '../errors'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from './ir'
import type { NormalizedEvent } from './stream-events'
import { invokeOpenAIChat, invokeOpenAIChatStream } from '../providers/openai/client'
import { invokeOpenAIResponses, invokeOpenAIResponsesStream } from '../providers/openai/responses-client'
import { invokeAnthropicMessages, invokeAnthropicMessagesStream } from '../providers/anthropic/client'

/**
 * Invoke the resolved upstream target, selecting the right client by
 * `target.kind` and (for OpenAI) `target.wireApi`. The wire-format decision
 * lives here, not in the provider clients.
 */
export async function invokeUpstream(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  if (target.kind === 'openai') {
    return target.wireApi === 'responses'
      ? invokeOpenAIResponses(request, target)
      : invokeOpenAIChat(request, target)
  }
  if (target.kind === 'anthropic') {
    return invokeAnthropicMessages(request, target)
  }
  throw new ValidationError(`Unsupported upstream kind: ${target.kind}`)
}

export async function invokeUpstreamStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<NormalizedEvent>> {
  if (target.kind === 'openai') {
    return target.wireApi === 'responses'
      ? invokeOpenAIResponsesStream(request, target)
      : invokeOpenAIChatStream(request, target)
  }
  if (target.kind === 'anthropic') {
    return invokeAnthropicMessagesStream(request, target)
  }
  throw new ValidationError(`Unsupported upstream kind: ${target.kind}`)
}

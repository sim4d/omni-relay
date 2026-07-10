import { AuthenticationError, UpstreamAPIError } from '../../errors'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from '../../core/ir'
import { parseJsonResponse, buildUpstreamErrorDetails } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIChatRequest } from './map-request'
import { mapOpenAIChatResponseToNormalizedResult } from './map-response'
import { mapOpenAIChatStreamToEvents } from './map-stream'

export async function invokeOpenAIChat(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(mapNormalizedRequestToOpenAIChatRequest(request)),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    throw new UpstreamAPIError('OpenAI upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  return mapOpenAIChatResponseToNormalizedResult(payload)
}

export async function invokeOpenAIChatStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...mapNormalizedRequestToOpenAIChatRequest(request),
      stream: true,
    }),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    throw new UpstreamAPIError('OpenAI upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('OpenAI upstream response did not include a streaming body')
  }

  return mapOpenAIChatStreamToEvents(upstream.body)
}

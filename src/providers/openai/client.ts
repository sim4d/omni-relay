import { AuthenticationError, UpstreamAPIError } from '../../errors'
import { log } from '../../observability'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from '../../core/ir'
import { parseJsonResponse, buildUpstreamErrorDetails } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIChatRequest } from './map-request'
import { mapOpenAIChatResponseToNormalizedResult } from './map-response'
import { mapOpenAIChatStreamToEvents } from './map-stream'

export async function invokeOpenAIChat(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const body = mapNormalizedRequestToOpenAIChatRequest(request)
  const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    logUpstreamFailure('chat', target, body, upstream.status, payload)
    throw new UpstreamAPIError('OpenAI upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  return mapOpenAIChatResponseToNormalizedResult(payload)
}

export async function invokeOpenAIChatStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const body = { ...mapNormalizedRequestToOpenAIChatRequest(request), stream: true }
  const upstream = await fetch(`${target.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    logUpstreamFailure('chat_stream', target, body, upstream.status, payload)
    throw new UpstreamAPIError('OpenAI upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('OpenAI upstream response did not include a streaming body')
  }

  return mapOpenAIChatStreamToEvents(upstream.body)
}

/**
 * Log the request body keys + upstream error payload when an upstream call
 * fails, so we can diagnose which field the upstream rejects (e.g. z.ai 1210).
 */
function logUpstreamFailure(
  wire: string,
  target: UpstreamTarget,
  body: Record<string, unknown>,
  status: number,
  payload: unknown,
): void {
  log('error', 'upstream_request_failed_detail', {
    wire,
    upstreamSlot: target.slot,
    upstreamBaseUrl: target.baseUrl,
    upstreamStatus: status,
    requestBodyKeys: Object.keys(body),
    requestBody: JSON.stringify(body).slice(0, 2000),
    // Include specific fields known to cause 400s on strict providers
    reasoningEffort: (body as Record<string, unknown>).reasoning_effort,
    maxCompletionTokens: (body as Record<string, unknown>).max_completion_tokens,
    parallelToolCalls: (body as Record<string, unknown>).parallel_tool_calls,
    upstreamPayload: payload,
  })
}

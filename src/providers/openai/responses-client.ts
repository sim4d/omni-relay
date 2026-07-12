import { AuthenticationError, UpstreamAPIError } from '../../errors'
import { log } from '../../observability'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from '../../core/ir'
import { parseJsonResponse, buildUpstreamErrorDetails } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIResponsesRequest } from './map-responses-request'
import { mapOpenAIResponsesResponseToNormalizedResult } from './map-responses-response'
import { mapOpenAIResponsesStreamToEvents } from './map-responses-stream'

export async function invokeOpenAIResponses(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const body = mapNormalizedRequestToOpenAIResponsesRequest(request)
  const upstream = await fetch(`${target.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    logUpstreamFailure('responses', target, body, upstream.status, payload)
    throw new UpstreamAPIError('OpenAI Responses upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  return mapOpenAIResponsesResponseToNormalizedResult(payload)
}

export async function invokeOpenAIResponsesStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_KEY_${target.slot} is not configured in the Worker environment`)
  }

  const body = { ...mapNormalizedRequestToOpenAIResponsesRequest(request), stream: true }
  const upstream = await fetch(`${target.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    logUpstreamFailure('responses_stream', target, body, upstream.status, payload)
    throw new UpstreamAPIError('OpenAI Responses upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('OpenAI Responses upstream response did not include a streaming body')
  }

  return mapOpenAIResponsesStreamToEvents(upstream.body)
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
    upstreamPayload: payload,
  })
}

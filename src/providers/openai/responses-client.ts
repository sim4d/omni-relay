import { AuthenticationError, UpstreamAPIError } from '../../errors'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from '../../core/ir'
import { parseJsonResponse } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIResponsesRequest } from './map-responses-request'
import { mapOpenAIResponsesResponseToNormalizedResult } from './map-responses-response'
import { mapOpenAIResponsesStreamToEvents } from './map-responses-stream'

export async function invokeOpenAIResponses(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_API_${target.slot} is not configured in the Worker environment`)
  }

  const upstream = await fetch(`${target.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(mapNormalizedRequestToOpenAIResponsesRequest(request)),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    throw new UpstreamAPIError('OpenAI Responses upstream request failed', {
      status: upstream.status,
      payload,
    }, upstream.status)
  }

  return mapOpenAIResponsesResponseToNormalizedResult(payload)
}

export async function invokeOpenAIResponsesStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!target.apiKey) {
    throw new AuthenticationError(`OPENAI_API_${target.slot} is not configured in the Worker environment`)
  }

  const upstream = await fetch(`${target.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...mapNormalizedRequestToOpenAIResponsesRequest(request),
      stream: true,
    }),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    throw new UpstreamAPIError('OpenAI Responses upstream request failed', {
      status: upstream.status,
      payload,
    }, upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('OpenAI Responses upstream response did not include a streaming body')
  }

  return mapOpenAIResponsesStreamToEvents(upstream.body)
}

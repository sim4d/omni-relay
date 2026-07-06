import { AuthenticationError, UpstreamAPIError } from '../../errors'
import type { AppEnv } from '../../env'
import type { NormalizedRequest, NormalizedResult } from '../../core/ir'
import { parseJsonResponse } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIResponsesRequest } from './map-responses-request'
import { mapOpenAIResponsesResponseToNormalizedResult } from './map-responses-response'
import { mapOpenAIResponsesStreamToEvents } from './map-responses-stream'
import { requireOpenAIBaseUrl } from '../upstream-base-url'

export async function invokeOpenAIResponses(request: NormalizedRequest, env: AppEnv): Promise<NormalizedResult> {
  if (!env.OPENAI_API_KEY) {
    throw new AuthenticationError('OPENAI_API_KEY is not configured in the Worker environment')
  }
  const openAIBaseUrl = requireOpenAIBaseUrl(env)

  const upstream = await fetch(`${openAIBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
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

export async function invokeOpenAIResponsesStream(request: NormalizedRequest, env: AppEnv): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!env.OPENAI_API_KEY) {
    throw new AuthenticationError('OPENAI_API_KEY is not configured in the Worker environment')
  }
  const openAIBaseUrl = requireOpenAIBaseUrl(env)

  const upstream = await fetch(`${openAIBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
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

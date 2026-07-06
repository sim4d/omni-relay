import { AuthenticationError, UnsupportedFeatureError, UpstreamAPIError } from '../../errors'
import type { AppEnv } from '../../env'
import type { NormalizedRequest, NormalizedResult } from '../../core/ir'
import { parseJsonResponse } from '../../lib/fetch'
import { mapNormalizedRequestToOpenAIResponsesRequest } from './map-responses-request'
import { mapOpenAIResponsesResponseToNormalizedResult } from './map-responses-response'

export async function invokeOpenAIResponses(request: NormalizedRequest, env: AppEnv): Promise<NormalizedResult> {
  if (request.stream) {
    throw new UnsupportedFeatureError('Streaming is not implemented yet for the OpenAI Responses route')
  }

  if (!env.OPENAI_API_KEY) {
    throw new AuthenticationError('OPENAI_API_KEY is not configured in the Worker environment')
  }

  const upstream = await fetch(`${env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/responses`, {
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

import { AuthenticationError, UnsupportedFeatureError, UpstreamAPIError } from '../../errors'
import { parseJsonResponse } from '../../lib/fetch'
import type { AppEnv } from '../../env'
import type { NormalizedRequest, NormalizedResult } from '../../core/ir'
import { mapNormalizedRequestToOpenAIChatRequest } from './map-request'
import { mapOpenAIChatResponseToNormalizedResult } from './map-response'

export async function invokeOpenAIChat(request: NormalizedRequest, env: AppEnv): Promise<NormalizedResult> {
  if (request.stream) {
    throw new UnsupportedFeatureError('Streaming is not implemented yet for the OpenAI Chat route')
  }

  if (!env.OPENAI_API_KEY) {
    throw new AuthenticationError('OPENAI_API_KEY is not configured in the Worker environment')
  }

  const upstream = await fetch(`${env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(mapNormalizedRequestToOpenAIChatRequest(request)),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    throw new UpstreamAPIError('OpenAI upstream request failed', {
      status: upstream.status,
      payload,
    }, upstream.status)
  }

  return mapOpenAIChatResponseToNormalizedResult(payload)
}

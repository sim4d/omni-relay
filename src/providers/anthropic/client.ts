import { AuthenticationError, UnsupportedFeatureError, UpstreamAPIError } from '../../errors'
import type { AppEnv } from '../../env'
import type { NormalizedRequest, NormalizedResult } from '../../core/ir'
import { parseJsonResponse } from '../../lib/fetch'
import { mapNormalizedRequestToAnthropicMessagesRequest } from './map-request'
import { mapAnthropicMessagesResponseToNormalizedResult } from './map-response'

export async function invokeAnthropicMessages(request: NormalizedRequest, env: AppEnv): Promise<NormalizedResult> {
  if (request.stream) {
    throw new UnsupportedFeatureError('Streaming is not implemented yet for the Anthropic Messages route')
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new AuthenticationError('ANTHROPIC_API_KEY is not configured in the Worker environment')
  }

  const upstream = await fetch(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(mapNormalizedRequestToAnthropicMessagesRequest(request)),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    throw new UpstreamAPIError('Anthropic upstream request failed', {
      status: upstream.status,
      payload,
    }, upstream.status)
  }

  return mapAnthropicMessagesResponseToNormalizedResult(payload)
}

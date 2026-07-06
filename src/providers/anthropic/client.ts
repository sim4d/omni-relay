import { AuthenticationError, UpstreamAPIError } from '../../errors'
import type { AppEnv } from '../../env'
import type { NormalizedRequest, NormalizedResult } from '../../core/ir'
import { parseJsonResponse } from '../../lib/fetch'
import { mapNormalizedRequestToAnthropicMessagesRequest } from './map-request'
import { mapAnthropicMessagesResponseToNormalizedResult } from './map-response'
import { mapAnthropicStreamToEvents } from './map-stream'

export async function invokeAnthropicMessages(request: NormalizedRequest, env: AppEnv): Promise<NormalizedResult> {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    throw new AuthenticationError('Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is configured in the Worker environment')
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (env.ANTHROPIC_AUTH_TOKEN) {
    headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`
  }
  if (env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = env.ANTHROPIC_API_KEY
  }

  const upstream = await fetch(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers,
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

export async function invokeAnthropicMessagesStream(request: NormalizedRequest, env: AppEnv): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    throw new AuthenticationError('Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN is configured in the Worker environment')
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (env.ANTHROPIC_AUTH_TOKEN) {
    headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`
  }
  if (env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = env.ANTHROPIC_API_KEY
  }

  const upstream = await fetch(`${env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...mapNormalizedRequestToAnthropicMessagesRequest(request),
      stream: true,
    }),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    throw new UpstreamAPIError('Anthropic upstream request failed', {
      status: upstream.status,
      payload,
    }, upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('Anthropic upstream response did not include a streaming body')
  }

  return mapAnthropicStreamToEvents(upstream.body)
}

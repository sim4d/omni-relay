import { AuthenticationError, UpstreamAPIError } from '../../errors'
import type { NormalizedRequest, NormalizedResult, UpstreamTarget } from '../../core/ir'
import { parseJsonResponse, buildUpstreamErrorDetails } from '../../lib/fetch'
import { mapNormalizedRequestToAnthropicMessagesRequest } from './map-request'
import { mapAnthropicMessagesResponseToNormalizedResult } from './map-response'
import { mapAnthropicStreamToEvents } from './map-stream'

function authHeaders(target: UpstreamTarget): Record<string, string> {
  if (!target.authToken) {
    throw new AuthenticationError(`ANTHROPIC_AUTH_${target.slot} is not configured in the Worker environment`)
  }
  return {
    authorization: `Bearer ${target.authToken}`,
  }
}

export async function invokeAnthropicMessages(request: NormalizedRequest, target: UpstreamTarget): Promise<NormalizedResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...authHeaders(target),
  }

  const upstream = await fetch(`${target.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(mapNormalizedRequestToAnthropicMessagesRequest(request)),
  })

  const payload = await parseJsonResponse(upstream)

  if (!upstream.ok) {
    throw new UpstreamAPIError('Anthropic upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  return mapAnthropicMessagesResponseToNormalizedResult(payload)
}

export async function invokeAnthropicMessagesStream(request: NormalizedRequest, target: UpstreamTarget): Promise<AsyncIterable<import('../../core/stream-events').NormalizedEvent>> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...authHeaders(target),
  }

  const upstream = await fetch(`${target.baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...mapNormalizedRequestToAnthropicMessagesRequest(request),
      stream: true,
    }),
  })

  if (!upstream.ok) {
    const payload = await parseJsonResponse(upstream)
    throw new UpstreamAPIError('Anthropic upstream request failed', buildUpstreamErrorDetails(upstream, payload), upstream.status)
  }

  if (!upstream.body) {
    throw new UpstreamAPIError('Anthropic upstream response did not include a streaming body')
  }

  return mapAnthropicStreamToEvents(upstream.body)
}

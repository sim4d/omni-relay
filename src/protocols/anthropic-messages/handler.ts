import { AuthenticationError, ValidationError } from '../../errors'
import { parseRelayCredential, validateRelayAuthorization } from '../../auth'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectUpstreamTarget } from '../../core/routing'
import { invokeUpstream, invokeUpstreamStream } from '../../core/upstream-dispatch'
import type { AppEnv } from '../../env'
import { jsonResponse } from '../../lib/http'
import { readJsonBody } from '../../lib/json'
import { log, type RequestContext } from '../../observability'
import { parseAnthropicMessagesRequest } from './parse'
import { renderAnthropicMessagesResponse } from './render'
import { renderAnthropicMessagesStream } from './stream'
import { resolveUpstreamTargets } from '../../config'

export async function handleAnthropicMessages(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const credential = parseRelayCredential(request)
  if (!validateRelayAuthorization(env, credential?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseAnthropicMessagesRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one message is required for the Anthropic Messages route')
  }

  const targets = resolveUpstreamTargets(env)
  const target = selectUpstreamTarget(normalized, targets)
  normalized.targetSlot = target.slot
  assertMilestoneOneFeatureSupport(normalized, target.kind, 'messages')
  log('info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'messages',
    provider: target.kind,
    upstreamSlot: target.slot,
    model: normalized.targetModel,
    stream: normalized.stream,
  })
  if (normalized.stream) {
    const upstreamStartedAt = Date.now()
    const events = await invokeUpstreamStream(normalized, target)
    const upstreamLatencyMs = Date.now() - upstreamStartedAt
    log('info', 'upstream_invocation_ready', {
      requestId: requestContext.requestId,
      routeProtocol: 'messages',
      provider: target.kind,
      upstreamSlot: target.slot,
      model: normalized.targetModel,
      stream: true,
      upstreamLatencyMs,
    })

    return new Response(renderAnthropicMessagesStream(events), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': requestContext.requestId,
        'x-omni-selected-provider': target.kind,
        'x-omni-route-protocol': 'messages',
        'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
      },
    })
  }

  const upstreamStartedAt = Date.now()
  const result = await invokeUpstream(normalized, target)
  const upstreamLatencyMs = Date.now() - upstreamStartedAt
  log('info', 'upstream_invocation_ready', {
    requestId: requestContext.requestId,
    routeProtocol: 'messages',
    provider: target.kind,
    upstreamSlot: target.slot,
    model: normalized.targetModel,
    stream: false,
    upstreamLatencyMs,
  })
  return jsonResponse(renderAnthropicMessagesResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': target.kind,
      'x-omni-route-protocol': 'messages',
      'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
    },
  })
}

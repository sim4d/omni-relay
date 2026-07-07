import { AuthenticationError, ValidationError } from '../../errors'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectUpstreamTarget } from '../../core/routing'
import { invokeUpstream, invokeUpstreamStream } from '../../core/upstream-dispatch'
import { parseRelayCredential, validateRelayAuthorization } from '../../auth'
import { readJsonBody } from '../../lib/json'
import { jsonResponse } from '../../lib/http'
import { renderOpenAIChatResponse } from './render'
import { parseOpenAIChatRequest } from './parse'
import { resolveUpstreamTargets } from '../../config'
import type { AppEnv } from '../../env'
import { log, type RequestContext } from '../../observability'
import { renderOpenAIChatStream } from './stream'

export async function handleOpenAIChatCompletions(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const credential = parseRelayCredential(request)
  if (!validateRelayAuthorization(env, credential?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseOpenAIChatRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one non-instruction message is required')
  }

  const targets = resolveUpstreamTargets(env)
  const target = selectUpstreamTarget(normalized, targets)
  normalized.targetSlot = target.slot
  assertMilestoneOneFeatureSupport(normalized, target.kind, 'chat')
  log('info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'chat',
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
      routeProtocol: 'chat',
      provider: target.kind,
      upstreamSlot: target.slot,
      model: normalized.targetModel,
      stream: true,
      upstreamLatencyMs,
    })
    return new Response(renderOpenAIChatStream(events), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': requestContext.requestId,
        'x-omni-selected-provider': target.kind,
        'x-omni-route-protocol': 'chat',
        'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
      },
    })
  }

  const upstreamStartedAt = Date.now()
  const result = await invokeUpstream(normalized, target)
  const upstreamLatencyMs = Date.now() - upstreamStartedAt
  log('info', 'upstream_invocation_ready', {
    requestId: requestContext.requestId,
    routeProtocol: 'chat',
    provider: target.kind,
    upstreamSlot: target.slot,
    model: normalized.targetModel,
    stream: false,
    upstreamLatencyMs,
  })
  return jsonResponse(renderOpenAIChatResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': target.kind,
      'x-omni-route-protocol': 'chat',
      'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
    },
  })
}

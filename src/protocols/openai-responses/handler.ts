import { AuthenticationError, ValidationError } from '../../errors'
import { parseRelayCredential, validateRelayAuthorization } from '../../auth'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectUpstreamTargetWithFallback } from '../../core/routing'
import { invokeUpstream, invokeUpstreamStream } from '../../core/upstream-dispatch'
import type { AppEnv } from '../../env'
import { jsonResponse } from '../../lib/http'
import { readJsonBody } from '../../lib/json'
import { log, type RequestContext } from '../../observability'
import { parseOpenAIResponsesRequest } from './parse'
import { renderOpenAIResponsesResponse } from './render'
import { renderOpenAIResponsesStream } from './stream'
import { resolveUpstreamTargets } from '../../config'

export async function handleOpenAIResponses(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const credential = parseRelayCredential(request)
  if (!validateRelayAuthorization(env, credential?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseOpenAIResponsesRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one message is required for the OpenAI Responses route')
  }

  const targets = resolveUpstreamTargets(env)
  const { target, fallbackFrom } = selectUpstreamTargetWithFallback(normalized, targets)
  normalized.targetSlot = target.slot
  assertMilestoneOneFeatureSupport(normalized, target.kind, 'responses')
  if (fallbackFrom) {
    log('warn', 'routing_model_fallback', {
      requestId: requestContext.requestId,
      from: fallbackFrom,
      to: normalized.targetModel,
    })
  }
  log('info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'responses',
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
      routeProtocol: 'responses',
      provider: target.kind,
      upstreamSlot: target.slot,
      model: normalized.targetModel,
      stream: true,
      upstreamLatencyMs,
    })

    return new Response(renderOpenAIResponsesStream(events), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': requestContext.requestId,
        'x-omni-selected-provider': target.kind,
        'x-omni-route-protocol': 'responses',
        'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
      },
    })
  }

  const upstreamStartedAt = Date.now()
  const result = await invokeUpstream(normalized, target)
  const upstreamLatencyMs = Date.now() - upstreamStartedAt
  log('info', 'upstream_invocation_ready', {
    requestId: requestContext.requestId,
    routeProtocol: 'responses',
    provider: target.kind,
    upstreamSlot: target.slot,
    model: normalized.targetModel,
    stream: false,
    upstreamLatencyMs,
  })
  return jsonResponse(renderOpenAIResponsesResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': target.kind,
      'x-omni-route-protocol': 'responses',
      'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
    },
  })
}

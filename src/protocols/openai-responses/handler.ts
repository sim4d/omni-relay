import { AuthenticationError, ValidationError } from '../../errors'
import { parseRelayCredential, validateRelayAuthorization } from '../../auth'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectProvider } from '../../core/routing'
import type { AppEnv } from '../../env'
import { jsonResponse } from '../../lib/http'
import { readJsonBody } from '../../lib/json'
import { log, type RequestContext } from '../../observability'
import { invokeAnthropicMessages, invokeAnthropicMessagesStream } from '../../providers/anthropic/client'
import { invokeOpenAIResponses, invokeOpenAIResponsesStream } from '../../providers/openai/responses-client'
import { parseOpenAIResponsesRequest } from './parse'
import { renderOpenAIResponsesResponse } from './render'
import { renderOpenAIResponsesStream } from './stream'

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

  const provider = selectProvider(normalized)
  assertMilestoneOneFeatureSupport(normalized, provider, 'responses')
  log(env, 'info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'responses',
    provider,
    model: normalized.targetModel,
    stream: normalized.stream,
  })
  if (normalized.stream) {
    const upstreamStartedAt = Date.now()
    const events =
      provider === 'openai'
        ? await invokeOpenAIResponsesStream(normalized, env)
        : provider === 'anthropic'
          ? await invokeAnthropicMessagesStream(normalized, env)
          : (() => {
              throw new ValidationError(`Unsupported provider selected for OpenAI Responses route: ${provider}`)
            })()
    const upstreamLatencyMs = Date.now() - upstreamStartedAt
    log(env, 'info', 'upstream_invocation_ready', {
      requestId: requestContext.requestId,
      routeProtocol: 'responses',
      provider,
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
        'x-omni-selected-provider': provider,
        'x-omni-route-protocol': 'responses',
        'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
      },
    })
  }

  const upstreamStartedAt = Date.now()
  const result =
    provider === 'openai'
      ? await invokeOpenAIResponses(normalized, env)
      : provider === 'anthropic'
        ? await invokeAnthropicMessages(normalized, env)
        : (() => {
            throw new ValidationError(`Unsupported provider selected for OpenAI Responses route: ${provider}`)
          })()
  const upstreamLatencyMs = Date.now() - upstreamStartedAt
  log(env, 'info', 'upstream_invocation_ready', {
    requestId: requestContext.requestId,
    routeProtocol: 'responses',
    provider,
    model: normalized.targetModel,
    stream: false,
    upstreamLatencyMs,
  })
  return jsonResponse(renderOpenAIResponsesResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': provider,
      'x-omni-route-protocol': 'responses',
      'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
    },
  })
}

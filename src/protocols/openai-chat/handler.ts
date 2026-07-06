import { AuthenticationError, ValidationError } from '../../errors'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectProvider } from '../../core/routing'
import { parseRelayCredential, validateRelayAuthorization } from '../../auth'
import { readJsonBody } from '../../lib/json'
import { jsonResponse } from '../../lib/http'
import { renderOpenAIChatResponse } from './render'
import { parseOpenAIChatRequest } from './parse'
import { invokeOpenAIChat, invokeOpenAIChatStream } from '../../providers/openai/client'
import { invokeAnthropicMessages, invokeAnthropicMessagesStream } from '../../providers/anthropic/client'
import type { AppEnv } from '../../env'
import { log, type RequestContext } from '../../observability'
import { renderOpenAIChatStream } from './stream'
import { invokeOpenAIResponses, invokeOpenAIResponsesStream } from '../../providers/openai/responses-client'
import { getConfig } from '../../config'

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

  const provider = selectProvider(normalized)
  const config = getConfig(env)
  assertMilestoneOneFeatureSupport(normalized, provider, 'chat')
  log(env, 'info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'chat',
    provider,
    model: normalized.targetModel,
    stream: normalized.stream,
  })
  if (normalized.stream) {
    const upstreamStartedAt = Date.now()
    const events =
      provider === 'openai'
        ? config.openAIWireApi === 'chat_completions'
          ? await invokeOpenAIChatStream(normalized, env)
          : await invokeOpenAIResponsesStream(normalized, env)
        : provider === 'anthropic'
          ? await invokeAnthropicMessagesStream(normalized, env)
          : (() => {
              throw new ValidationError(`Unsupported provider selected for OpenAI Chat route: ${provider}`)
            })()
    const upstreamLatencyMs = Date.now() - upstreamStartedAt
    log(env, 'info', 'upstream_invocation_ready', {
      requestId: requestContext.requestId,
      routeProtocol: 'chat',
      provider,
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
        'x-omni-selected-provider': provider,
        'x-omni-route-protocol': 'chat',
        'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
      },
    })
  }

  const upstreamStartedAt = Date.now()
  const result =
    provider === 'openai'
      ? config.openAIWireApi === 'chat_completions'
        ? await invokeOpenAIChat(normalized, env)
        : await invokeOpenAIResponses(normalized, env)
      : provider === 'anthropic'
        ? await invokeAnthropicMessages(normalized, env)
        : (() => {
            throw new ValidationError(`Unsupported provider selected for OpenAI Chat route: ${provider}`)
          })()
  const upstreamLatencyMs = Date.now() - upstreamStartedAt
  log(env, 'info', 'upstream_invocation_ready', {
    requestId: requestContext.requestId,
    routeProtocol: 'chat',
    provider,
    model: normalized.targetModel,
    stream: false,
    upstreamLatencyMs,
  })
  return jsonResponse(renderOpenAIChatResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': provider,
      'x-omni-route-protocol': 'chat',
      'x-omni-upstream-latency-ms': String(upstreamLatencyMs),
    },
  })
}

import { AuthenticationError, ValidationError } from '../../errors'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectProvider } from '../../core/routing'
import { parseAuthorizationHeader, validateRelayAuthorization } from '../../auth'
import { readJsonBody } from '../../lib/json'
import { jsonResponse } from '../../lib/http'
import { renderOpenAIChatResponse } from './render'
import { parseOpenAIChatRequest } from './parse'
import { invokeOpenAIChat, invokeOpenAIChatStream } from '../../providers/openai/client'
import { invokeAnthropicMessages, invokeAnthropicMessagesStream } from '../../providers/anthropic/client'
import type { AppEnv } from '../../env'
import { log, type RequestContext } from '../../observability'
import { renderOpenAIChatStream } from './stream'

export async function handleOpenAIChatCompletions(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const bearer = parseAuthorizationHeader(request)
  if (!validateRelayAuthorization(env, bearer?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseOpenAIChatRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one non-instruction message is required')
  }

  const provider = selectProvider(normalized)
  assertMilestoneOneFeatureSupport(normalized, provider, 'chat')
  log(env, 'info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'chat',
    provider,
    model: normalized.targetModel,
    stream: normalized.stream,
  })
  if (normalized.stream) {
    const events =
      provider === 'openai'
        ? await invokeOpenAIChatStream(normalized, env)
        : provider === 'anthropic'
          ? await invokeAnthropicMessagesStream(normalized, env)
          : (() => {
              throw new ValidationError(`Unsupported provider selected for OpenAI Chat route: ${provider}`)
            })()
    return new Response(renderOpenAIChatStream(events), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': requestContext.requestId,
        'x-omni-selected-provider': provider,
        'x-omni-route-protocol': 'chat',
      },
    })
  }

  const result =
    provider === 'openai'
      ? await invokeOpenAIChat(normalized, env)
      : provider === 'anthropic'
        ? await invokeAnthropicMessages(normalized, env)
        : (() => {
            throw new ValidationError(`Unsupported provider selected for OpenAI Chat route: ${provider}`)
          })()
  return jsonResponse(renderOpenAIChatResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': provider,
      'x-omni-route-protocol': 'chat',
    },
  })
}

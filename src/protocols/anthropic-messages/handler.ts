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
import { parseAnthropicMessagesRequest } from './parse'
import { renderAnthropicMessagesResponse } from './render'
import { renderAnthropicMessagesStream } from './stream'

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

  const provider = selectProvider(normalized)
  assertMilestoneOneFeatureSupport(normalized, provider, 'messages')
  log(env, 'info', 'relay_request_resolved', {
    requestId: requestContext.requestId,
    routeProtocol: 'messages',
    provider,
    model: normalized.targetModel,
    stream: normalized.stream,
  })
  if (normalized.stream) {
    const events =
      provider === 'anthropic'
        ? await invokeAnthropicMessagesStream(normalized, env)
        : provider === 'openai'
          ? await invokeOpenAIResponsesStream(normalized, env)
          : (() => {
              throw new ValidationError(`Unsupported provider selected for Anthropic Messages route: ${provider}`)
            })()

    return new Response(renderAnthropicMessagesStream(events), {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': requestContext.requestId,
        'x-omni-selected-provider': provider,
        'x-omni-route-protocol': 'messages',
      },
    })
  }

  const result =
    provider === 'anthropic'
      ? await invokeAnthropicMessages(normalized, env)
      : provider === 'openai'
        ? await invokeOpenAIResponses(normalized, env)
        : (() => {
            throw new ValidationError(`Unsupported provider selected for Anthropic Messages route: ${provider}`)
          })()
  return jsonResponse(renderAnthropicMessagesResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
      'x-omni-selected-provider': provider,
      'x-omni-route-protocol': 'messages',
    },
  })
}

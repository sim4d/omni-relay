import { getConfig } from './config'
import { MethodNotAllowedError, NotFoundError } from './errors'
import { jsonResponse } from './lib/http'
import type { AppEnv } from './env'
import type { RequestContext } from './observability'
import { handleDebugTranslate } from './debug/translate'
import { handleAnthropicMessages } from './protocols/anthropic-messages/handler'
import { handleOpenAIChatCompletions } from './protocols/openai-chat/handler'
import { handleOpenAIResponses } from './protocols/openai-responses/handler'

export async function routeRequest(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const url = new URL(request.url)
  const config = getConfig(env)

  if (url.pathname === '/healthz') {
    if (request.method !== 'GET') {
      throw new MethodNotAllowedError('Only GET is allowed for /healthz')
    }

    return jsonResponse(
      {
        ok: true,
        service: 'omni-relay',
        request_id: requestContext.requestId,
      },
      {
        status: 200,
        headers: {
          'x-request-id': requestContext.requestId,
        },
      },
    )
  }

  if (url.pathname === '/v1/chat/completions') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/chat/completions')
    }

    return handleOpenAIChatCompletions(request, env, requestContext)
  }

  if (url.pathname === '/v1/responses') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/responses')
    }

    return handleOpenAIResponses(request, env, requestContext)
  }

  if (url.pathname === '/v1/messages') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/messages')
    }

    return handleAnthropicMessages(request, env, requestContext)
  }

  if (url.pathname === '/v1/debug/translate') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/debug/translate')
    }

    if (!config.debugRoutesEnabled) {
      throw new NotFoundError(`No route registered for ${request.method} ${url.pathname}`)
    }

    return handleDebugTranslate(request, env, requestContext)
  }

  throw new NotFoundError(`No route registered for ${request.method} ${url.pathname}`)
}

import { MethodNotAllowedError, NotFoundError, NotImplementedError } from './errors'
import { jsonResponse } from './lib/http'
import type { AppEnv } from './env'
import type { RequestContext } from './observability'

export async function routeRequest(request: Request, env: AppEnv, ctx: ExecutionContext, requestContext: RequestContext): Promise<Response> {
  void env
  void ctx
  const url = new URL(request.url)

  if (url.pathname === '/healthz') {
    if (request.method !== 'GET') {
      throw new MethodNotAllowedError('Only GET is allowed for /healthz')
    }

    return jsonResponse(
      {
        ok: true,
        service: 'omni-relay',
        environment: env.ENVIRONMENT ?? 'development',
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

    throw new NotImplementedError('POST /v1/chat/completions is scaffolded but not implemented yet')
  }

  if (url.pathname === '/v1/responses') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/responses')
    }

    throw new NotImplementedError('POST /v1/responses is scaffolded but not implemented yet')
  }

  if (url.pathname === '/v1/messages') {
    if (request.method !== 'POST') {
      throw new MethodNotAllowedError('Only POST is allowed for /v1/messages')
    }

    throw new NotImplementedError('POST /v1/messages is scaffolded but not implemented yet')
  }

  throw new NotFoundError(`No route registered for ${request.method} ${url.pathname}`)
}

import { renderError } from './errors'
import { createRequestContext, log } from './observability'
import { routeRequest } from './router'
import type { AppEnv } from './env'

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const requestContext = createRequestContext(request)
    const startedAt = Date.now()

    try {
      const response = await routeRequest(request, env, requestContext)
      log('info', 'request_completed', {
        requestId: requestContext.requestId,
        method: requestContext.method,
        path: requestContext.path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      })
      return response
    } catch (error) {
      log('error', 'request_failed', {
        requestId: requestContext.requestId,
        method: requestContext.method,
        path: requestContext.path,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
      return renderError(error, requestContext.requestId)
    }
  },
}

import { renderError, type ErrorProtocol } from './errors'
import { createRequestContext, log } from './observability'
import { routeRequest } from './router'
import type { AppEnv } from './env'

function protocolForPath(path: string): ErrorProtocol {
  if (path.endsWith('/v1/messages')) return 'messages'
  if (path.endsWith('/v1/chat/completions')) return 'chat'
  if (path.endsWith('/v1/responses')) return 'responses'
  return 'generic'
}

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
        // Include structured error details (e.g. upstream status + payload)
        // so failures are diagnosable without reproducing interactively.
        ...(error && typeof error === 'object' && 'details' in error && error.details
          ? { errorDetails: error.details }
          : {}),
      })
      return renderError(error, requestContext.requestId, protocolForPath(requestContext.path))
    }
  },
}

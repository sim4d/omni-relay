import type { AppEnv } from './env'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type RequestContext = {
  requestId: string
  method: string
  path: string
}

export function createRequestContext(request: Request): RequestContext {
  const url = new URL(request.url)
  return {
    requestId: crypto.randomUUID(),
    method: request.method,
    path: url.pathname,
  }
}

export function log(env: AppEnv, level: LogLevel, message: string, extra: Record<string, unknown> = {}): void {
  const payload = {
    level,
    message,
    environment: env.ENVIRONMENT ?? 'development',
    ...extra,
  }

  console[level === 'debug' ? 'log' : level](JSON.stringify(payload))
}

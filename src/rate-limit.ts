import { parseAuthorizationHeader } from './auth'
import { RateLimitExceededError } from './errors'
import type { AppEnv } from './env'

function getRateLimitKey(request: Request): string {
  const bearer = parseAuthorizationHeader(request)
  if (bearer?.token) {
    return `bearer:${bearer.token}`
  }

  const ip =
    request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')
    ?? request.headers.get('x-real-ip')

  if (ip) {
    return `ip:${ip.split(',')[0]?.trim()}`
  }

  return `path:${new URL(request.url).pathname}`
}

export async function enforceRateLimit(request: Request, env: AppEnv): Promise<void> {
  const limiter = env.RATE_LIMITER
  if (!limiter) {
    return
  }

  const result = await limiter.limit({ key: getRateLimitKey(request) })
  if (!result.success) {
    throw new RateLimitExceededError('Rate limit exceeded for this client')
  }
}

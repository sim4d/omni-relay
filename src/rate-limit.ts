import { parseRelayCredential } from './auth'
import { RateLimitExceededError } from './errors'
import type { AppEnv } from './env'

function getRateLimitKey(request: Request): string {
  const credential = parseRelayCredential(request)
  if (credential?.token) {
    return `credential:${credential.token}`
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

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

function getRateLimitSettings(env: AppEnv): { limit: number; periodSeconds: number } | null {
  const limit = parsePositiveInt(env.RATE_LIMIT_MAX)
  const periodSeconds = parsePositiveInt(env.RATE_LIMIT_PERIOD_SECONDS)

  if (!limit || !periodSeconds) {
    return null
  }

  return { limit, periodSeconds }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export async function enforceRateLimit(request: Request, env: AppEnv): Promise<void> {
  const settings = getRateLimitSettings(env)
  const key = `${new URL(request.url).pathname}|${getRateLimitKey(request)}`

  if (env.RELAY_RATE_LIMITER_DO && settings) {
    const stub = env.RELAY_RATE_LIMITER_DO.getByName(await sha256Hex(key))
    const result = await stub.checkLimit({
      limit: settings.limit,
      periodSeconds: settings.periodSeconds,
      nowMs: Date.now(),
    })

    if (!result.success) {
      throw new RateLimitExceededError('Rate limit exceeded for this client', {
        retryAfterSeconds: result.retryAfterSeconds,
        resetAtMs: result.resetAtMs,
      })
    }

    return
  }

  const limiter = env.RATE_LIMITER
  if (!limiter) {
    return
  }

  const result = await limiter.limit({ key })
  if (!result.success) {
    throw new RateLimitExceededError('Rate limit exceeded for this client')
  }
}

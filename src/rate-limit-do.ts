import { DurableObject } from 'cloudflare:workers'
import type { AppEnv } from './env'

export type RateLimitCheckRequest = {
  limit: number
  periodSeconds: number
  nowMs: number
}

export type RateLimitCheckResponse = {
  success: boolean
  remaining: number
  resetAtMs: number
  retryAfterSeconds?: number
}

type StoredRateLimitWindow = {
  windowStartMs: number
  count: number
}

const WINDOW_STATE_KEY = 'window'

export class RelayRateLimiter extends DurableObject<AppEnv> {
  async alarm(): Promise<void> {
    await this.ctx.storage.delete(WINDOW_STATE_KEY)
  }

  async checkLimit(request: RateLimitCheckRequest): Promise<RateLimitCheckResponse> {
    const limit = Math.max(1, Math.floor(request.limit))
    const periodMs = Math.max(1, Math.floor(request.periodSeconds)) * 1000
    const nowMs = Math.max(0, Math.floor(request.nowMs))

    const existing = await this.ctx.storage.get<StoredRateLimitWindow>(WINDOW_STATE_KEY)
    const isExpired =
      !existing
      || nowMs >= existing.windowStartMs + periodMs

    const windowStartMs = isExpired ? nowMs : existing.windowStartMs
    const nextCount = isExpired ? 1 : existing.count + 1
    const resetAtMs = windowStartMs + periodMs
    const success = nextCount <= limit

    if (success) {
      await this.ctx.storage.put(WINDOW_STATE_KEY, {
        windowStartMs,
        count: nextCount,
      } satisfies StoredRateLimitWindow)
      await this.ctx.storage.setAlarm(resetAtMs)
      return {
        success: true,
        remaining: Math.max(0, limit - nextCount),
        resetAtMs,
      }
    }

    return {
      success: false,
      remaining: 0,
      resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
    }
  }
}

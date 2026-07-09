import { UpstreamAPIError } from '../errors'
import { log } from '../observability'

const MAX_RETRIES = 10
const MIN_DELAY_MS = 5_000
const MAX_DELAY_MS = 10_000
// Hard cap on total retry delay. Cloudflare Workers (standard plan) has a
// 30s wall-clock limit; we cap at 25s to leave room for the upstream call
// itself and response processing. On dev:node the full 10 retries may apply
// if the cap isn't reached first.
const MAX_TOTAL_DELAY_MS = 25_000

// HTTP status codes worth retrying: rate limiting + transient server errors.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export function isRetryableError(error: unknown): boolean {
  return error instanceof UpstreamAPIError && RETRYABLE_STATUSES.has(error.status)
}

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
}

/**
 * Wrap an async operation with automatic retries on transient upstream
 * failures (429, 5xx). Retries up to 10 times with a random 5-10s delay
 * between attempts, subject to a total delay cap of 25s. This ensures the
 * relay stays within the Cloudflare Workers 30s wall-clock limit while
 * retrying aggressively on local/dev:node where no such limit exists.
 *
 * Non-retryable errors (auth, validation, etc.) are re-thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  let totalDelayMs = 0

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      const budgetExhausted = totalDelayMs >= MAX_TOTAL_DELAY_MS
      if (attempt === MAX_RETRIES || !isRetryableError(error) || budgetExhausted) {
        if (budgetExhausted && attempt < MAX_RETRIES && isRetryableError(error)) {
          log('warn', 'upstream_retry_budget_exhausted', {
            attempt: attempt + 1,
            totalDelayMs,
            maxTotalDelayMs: MAX_TOTAL_DELAY_MS,
            upstreamStatus: (error as UpstreamAPIError).status,
          })
        }
        throw error
      }

      const delayMs = randomDelay()
      totalDelayMs += delayMs
      const upstreamStatus = (error as UpstreamAPIError).status

      log('warn', 'upstream_retry', {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs,
        totalDelayMs,
        maxTotalDelayMs: MAX_TOTAL_DELAY_MS,
        upstreamStatus,
        error: error instanceof Error ? error.message : String(error),
      })

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}

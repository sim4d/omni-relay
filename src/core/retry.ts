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
 * Parse a Retry-After header value (seconds or HTTP-date) into milliseconds.
 * Returns undefined if the value is absent or unparseable.
 */
function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined

  const trimmed = value.trim()

  // Numeric: seconds until retry
  const seconds = Number(trimmed)
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_TOTAL_DELAY_MS)
  }

  // HTTP-date format
  const date = new Date(trimmed)
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now()
    return delta > 0 ? Math.min(delta, MAX_TOTAL_DELAY_MS) : 0
  }

  return undefined
}

/**
 * Wrap an async operation with automatic retries on transient upstream
 * failures (429, 5xx). Retries up to 10 times with a random 5-10s delay
 * between attempts, subject to a total delay cap of 25s.
 *
 * When the upstream returns a 429 with a `Retry-After` header, the relay
 * honours that value (parsed from either seconds or HTTP-date format) and
 * waits exactly as long as the upstream requests before retrying, instead
 * of using the default random delay. This mirrors cliproxyapi's approach
 * of respecting the upstream's rate-limit guidance.
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

      // Check for Retry-After header from upstream 429/5xx responses.
      // The details object from upstream clients includes the raw response
      // headers when available.
      const details = (error as UpstreamAPIError).details
      let delayMs: number
      let retryAfterMs: number | undefined

      if (details && typeof details === 'object' && 'retryAfterMs' in details) {
        retryAfterMs = (details as { retryAfterMs?: number }).retryAfterMs
      }

      if (retryAfterMs !== undefined) {
        delayMs = Math.min(retryAfterMs, MAX_TOTAL_DELAY_MS - totalDelayMs)
        if (delayMs <= 0) {
          // Retry-After exceeds remaining budget — give up
          throw error
        }
      } else {
        delayMs = randomDelay()
      }

      totalDelayMs += delayMs
      const upstreamStatus = (error as UpstreamAPIError).status

      log('warn', 'upstream_retry', {
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs,
        totalDelayMs,
        maxTotalDelayMs: MAX_TOTAL_DELAY_MS,
        upstreamStatus,
        retryAfterHonoured: retryAfterMs !== undefined,
        error: error instanceof Error ? error.message : String(error),
      })

      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}

export { parseRetryAfterMs }

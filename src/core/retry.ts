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

// Some upstream providers return HTTP 400 with a provider-specific error code
// that is actually transient (rate-limit, internal glitch) rather than a true
// validation error. z.ai (ZhipuAI) returns code "1210" ("Invalid API
// parameter") intermittently even when the request body is valid — retrying
// with the identical body succeeds. We treat these as retryable to avoid
// hard-failing the client on a transient upstream hiccup.
const RETRYABLE_UPSTREAM_CODES = new Set(['1210'])

// HTTP-date regex (RFC 7231 §7.1.3 / IMF-fixdate). Validates that a string
// looks like an HTTP-date before passing it to the Date constructor, which is
// too lenient and would parse strings like "5, 10" as valid dates.
const HTTP_DATE_RE = /^[A-Za-z]{3},\s\d{1,2}\s[A-Za-z]{3}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT$/

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof UpstreamAPIError)) return false
  if (RETRYABLE_STATUSES.has(error.status)) return true

  // Check for transient upstream-specific 400s (e.g. z.ai code 1210).
  if (error.status === 400 && error.details && typeof error.details === 'object') {
    const details = error.details as Record<string, unknown>
    const payload = details.payload
    if (payload && typeof payload === 'object') {
      const errObj = (payload as Record<string, unknown>).error
      if (errObj && typeof errObj === 'object') {
        const code = (errObj as Record<string, unknown>).code
        if (typeof code === 'string' && RETRYABLE_UPSTREAM_CODES.has(code)) {
          return true
        }
      }
    }
  }

  return false
}

function randomDelay(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
}

/**
 * Parse a Retry-After header value (seconds or HTTP-date) into raw milliseconds.
 * Returns undefined if the value is absent or unparseable.
 */
function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  // Reject whitespace-only or otherwise empty input; otherwise `Number("")`
  // would yield 0 and we'd silently retry-now instead of falling back.
  if (!trimmed) return undefined

  // Reject negative numbers explicitly. They are not valid Retry-After values
  // (RFC 7231 §7.1.3 allows only non-negative integers or HTTP-dates), and
  // `new Date("-1")` is implementation-defined — some engines parse it as
  // 1 second before the epoch, which would cause a silent retry-now.
  if (trimmed.startsWith('-')) return undefined

  // Numeric: RFC 7231 §7.1.3 specifies non-negative decimal integers only.
  // Use a strict regex to reject hex (0x10), scientific notation (1e3),
  // comma-joined values (5, 10), and other non-decimal formats that
  // parseInt/Number would silently accept.
  if (/^\d+$/.test(trimmed)) {
    const parsed = parseInt(trimmed, 10)
    const ms = parsed * 1000
    // Guard against float overflow for very large values.
    if (Number.isFinite(ms)) {
      return ms
    }
    return undefined
  }

  // HTTP-date format (RFC 7231 §7.1.3): validate that the value resembles an
  // HTTP-date before calling Date(). V8's Date parser is lenient and will
  // parse strings like "5, 10" as a valid past date, which would incorrectly
  // return 0 (retry-now) instead of undefined.
  if (!HTTP_DATE_RE.test(trimmed)) {
    return undefined
  }
  const date = new Date(trimmed)
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - Date.now()
    return delta > 0 ? delta : 0
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
        const raw = (details as { retryAfterMs?: unknown }).retryAfterMs
        if (typeof raw === 'number' && raw >= 0) {
          retryAfterMs = raw
        }
      }

      if (retryAfterMs !== undefined) {
        // Retry-After: respect upstream guidance exactly. If the upstream's
        // requested wait exceeds our remaining budget, give up immediately
        // rather than silently capping — capping would violate upstream
        // guidance and may push us past the Workers 30s wall-clock limit.
        // Retry-After: 0 is a valid "retry now" hint (RFC 7231 §7.1.3) and
        // is honoured as a zero-delay retry; the MAX_RETRIES cap prevents
        // unbounded tight loops if the upstream keeps returning 0.
        const remainingBudget = MAX_TOTAL_DELAY_MS - totalDelayMs
        if (retryAfterMs > remainingBudget) {
          // Retry-After exceeds remaining budget — give up
          throw error
        }
        delayMs = retryAfterMs
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

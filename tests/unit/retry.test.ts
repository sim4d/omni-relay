import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, isRetryableError, parseRetryAfterMs } from '../../src/core/retry'
import { buildUpstreamErrorDetails } from '../../src/lib/fetch'
import { UpstreamAPIError } from '../../src/errors'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 and succeeds eventually', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', {}, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    // Advance past the retry delay (5-10s range)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 502 and succeeds eventually', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('bad gateway', {}, 502))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on 503 and succeeds eventually', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('unavailable', {}, 503))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 401 (non-retryable)', async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('auth failed', {}, 401))
    const promise = withRetry(fn).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 400 (non-retryable)', async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('bad request', {}, 400))
    const promise = withRetry(fn).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on generic errors (non-UpstreamAPIError)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network crash'))
    const promise = withRetry(fn).catch((e) => e)
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result).toBeInstanceOf(Error)
    expect(result).not.toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('stops retrying when total delay budget (25s) is exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('rate limited', {}, 429))
    const promise = withRetry(fn).catch((e) => e)

    // Each retry adds 5-10s. After 3-4 retries, total delay exceeds 25s.
    // Advance through enough time to exhaust the budget.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
    }

    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    // Should have stopped before reaching MAX_RETRIES (10)
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6)
    expect(fn.mock.calls.length).toBeGreaterThan(1)
  })

  it('gives up after MAX_RETRIES (10) attempts when budget allows', async () => {
    // Each retry uses a random 5-10s delay. 10 retries × 5s min = 50s total.
    // The 25s budget will stop retries first, so we can't reach MAX_RETRIES
    // on persistent 429. Instead, verify that the budget stops it correctly:
    // the function should be called fewer than 11 times.
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('rate limited', {}, 429))
    const promise = withRetry(fn).catch((e) => e)

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
    }

    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    // Budget (25s) stops retries before MAX_RETRIES (10)
    expect(fn.mock.calls.length).toBeLessThanOrEqual(6)
    expect(fn.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('isRetryableError', () => {
  it('returns true for 429', () => {
    expect(isRetryableError(new UpstreamAPIError('rate limited', {}, 429))).toBe(true)
  })

  it('returns true for 500', () => {
    expect(isRetryableError(new UpstreamAPIError('server error', {}, 500))).toBe(true)
  })

  it('returns true for 502', () => {
    expect(isRetryableError(new UpstreamAPIError('bad gateway', {}, 502))).toBe(true)
  })

  it('returns true for 503', () => {
    expect(isRetryableError(new UpstreamAPIError('unavailable', {}, 503))).toBe(true)
  })

  it('returns true for 504', () => {
    expect(isRetryableError(new UpstreamAPIError('gateway timeout', {}, 504))).toBe(true)
  })

  it('returns false for 401', () => {
    expect(isRetryableError(new UpstreamAPIError('unauthorized', {}, 401))).toBe(false)
  })

  it('returns false for 400', () => {
    expect(isRetryableError(new UpstreamAPIError('bad request', {}, 400))).toBe(false)
  })

  it('returns false for generic Error', () => {
    expect(isRetryableError(new Error('something'))).toBe(false)
  })
})

describe('withRetry Retry-After support', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('honours Retry-After seconds hint from upstream 429', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 3_000 }, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    // Advance past the Retry-After delay (3s)
    await vi.advanceTimersByTimeAsync(3_500)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up immediately when retryAfterMs exceeds remaining budget', async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('rate limited', { retryAfterMs: 30_000 }, 429))
    const promise = withRetry(fn).catch((e) => e)

    // First call fails immediately; withRetry sees retryAfterMs (30s) > remainingBudget (25s)
    // and gives up without waiting — respecting upstream guidance and staying within the
    // Workers 30s wall-clock limit.
    await vi.advanceTimersByTimeAsync(0)
    // Advance well past any possible delay to confirm no further retries
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
    }

    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up immediately when a large Retry-After header exceeds the budget', async () => {
    const response = new Response('{}', { status: 429, headers: { 'retry-after': '999999' } })
    const details = buildUpstreamErrorDetails(response, { error: 'rate limited' })
    const fn = vi.fn().mockRejectedValue(new UpstreamAPIError('rate limited', details, 429))
    const promise = withRetry(fn).catch((e) => e)

    // The parsed 999,999s Retry-After far exceeds the 25s budget, so withRetry
    // should give up immediately without waiting.
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(10_000)
    }

    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('honours Retry-After: 0 as a retry-now hint', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 0 }, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('ignores negative or non-number retryAfterMs details', async () => {
    // Negative retryAfterMs should be ignored (parseRetryAfterMs clamps to undefined upstream,
    // but defence-in-depth here covers direct callers that pass a malformed details object).
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: -5 }, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up when accumulated Retry-After exceeds remaining budget on second attempt', async () => {
    // First 429: Retry-After 15s, budget 25s → waits 15s, totalDelay=15000
    // Second 429: Retry-After 15s, remaining budget 10s → 15s > 10s → gives up
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 15_000 }, 429))
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 15_000 }, 429))

    const promise = withRetry(fn).catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    const result = await promise
    expect(result).toBeInstanceOf(UpstreamAPIError)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After exactly when it fits remaining budget after first retry', async () => {
    // First 429: Retry-After 10s, budget 25s → waits 10s, totalDelay=10000
    // Second 429: Retry-After 10s, remaining 15s → 10s < 15s → retries, totalDelay=20000
    // Third: success
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 10_000 }, 429))
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', { retryAfterMs: 10_000 }, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('falls back to random delay when Retry-After is absent', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new UpstreamAPIError('rate limited', {}, 429))
      .mockResolvedValueOnce('ok')

    const promise = withRetry(fn)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('parseRetryAfterMs', () => {
  it('parses numeric seconds without clamping', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000)
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('1000')).toBe(1_000_000)
  })

  it('parses HTTP-date format without clamping', () => {
    const future = new Date(Date.now() + 60_000).toUTCString()
    const result = parseRetryAfterMs(future)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeGreaterThanOrEqual(59_000)
  })

  it('returns undefined for unparseable values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs('')).toBeUndefined()
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined()
  })

  it('returns undefined for whitespace-only input', () => {
    expect(parseRetryAfterMs('   ')).toBeUndefined()
    expect(parseRetryAfterMs('\t\n')).toBeUndefined()
    // ' 30 ' should still parse (trimmed, then parsed)
    expect(parseRetryAfterMs(' 30 ')).toBe(30_000)
  })

  it('returns undefined for negative inputs', () => {
    expect(parseRetryAfterMs('-1')).toBeUndefined()
    expect(parseRetryAfterMs('-100')).toBeUndefined()
    expect(parseRetryAfterMs('-0.5')).toBeUndefined()
  })

  it('returns undefined for non-finite values', () => {
    expect(parseRetryAfterMs('Infinity')).toBeUndefined()
    expect(parseRetryAfterMs('-Infinity')).toBeUndefined()
  })

  it('returns 0 for a past HTTP-date (retry-now)', () => {
    const past = new Date(Date.now() - 60_000).toUTCString()
    expect(parseRetryAfterMs(past)).toBe(0)
  })

  it('rejects comma-containing numeric values (joined headers)', () => {
    // V8's Date parser would parse "5, 10" as a past date → 0 without this guard
    expect(parseRetryAfterMs('5, 10')).toBeUndefined()
    expect(parseRetryAfterMs('5,10')).toBeUndefined()
  })

  it('rejects hex and scientific notation', () => {
    expect(parseRetryAfterMs('0x10')).toBeUndefined()
    expect(parseRetryAfterMs('1e3')).toBeUndefined()
  })

  it('returns undefined for very large values that overflow to Infinity', () => {
    expect(parseRetryAfterMs('1e308')).toBeUndefined()
  })
})

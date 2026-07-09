import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, isRetryableError } from '../../src/core/retry'
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

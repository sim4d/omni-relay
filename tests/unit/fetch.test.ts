import { describe, expect, it } from 'vitest'
import { extractRetryAfterMs, buildUpstreamErrorDetails } from '../../src/lib/fetch'

function makeResponse(status: number, retryAfter: string | null): Response {
  const headers = new Headers()
  if (retryAfter !== null) headers.set('retry-after', retryAfter)
  return new Response('{}', { status, headers })
}

describe('extractRetryAfterMs', () => {
  it('returns undefined when the header is absent', () => {
    expect(extractRetryAfterMs(makeResponse(429, null))).toBeUndefined()
  })

  it('parses numeric seconds', () => {
    expect(extractRetryAfterMs(makeResponse(429, '10'))).toBe(10_000)
  })

  it('does not clamp very large numeric values', () => {
    expect(extractRetryAfterMs(makeResponse(429, '999999'))).toBe(999_999_000)
  })

  it('returns 0 for "0"', () => {
    expect(extractRetryAfterMs(makeResponse(429, '0'))).toBe(0)
  })

  it('returns undefined for unparseable values', () => {
    expect(extractRetryAfterMs(makeResponse(429, 'not-a-date-or-number'))).toBeUndefined()
  })

  it('parses HTTP-date format in the future without clamping', () => {
    const future = new Date(Date.now() + 60_000).toUTCString()
    const result = extractRetryAfterMs(makeResponse(503, future))
    expect(result).toBeGreaterThan(0)
    expect(result).toBeGreaterThanOrEqual(59_000)
  })
})

describe('buildUpstreamErrorDetails', () => {
  it('includes status and payload when no Retry-After header', () => {
    const response = makeResponse(500, null)
    const details = buildUpstreamErrorDetails(response, { error: 'boom' })
    expect(details).toEqual({ status: 500, payload: { error: 'boom' } })
  })

  it('adds retryAfterMs when the upstream provides Retry-After', () => {
    const response = makeResponse(429, '15')
    const details = buildUpstreamErrorDetails(response, { error: 'rate limited' })
    expect(details.status).toBe(429)
    expect(details.payload).toEqual({ error: 'rate limited' })
    expect(details.retryAfterMs).toBe(15_000)
  })

  it('omits retryAfterMs when the header value is unparseable', () => {
    const response = makeResponse(429, 'garbage')
    const details = buildUpstreamErrorDetails(response, null)
    expect(details.retryAfterMs).toBeUndefined()
    expect(details).toEqual({ status: 429, payload: null })
  })
})

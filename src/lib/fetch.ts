import { UpstreamAPIError } from '../errors'
import { parseRetryAfterMs } from '../core/retry'

export async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    throw new UpstreamAPIError('Upstream provider returned non-JSON response', {
      status: response.status,
      bodyPreview: text.slice(0, 500),
    })
  }
}

/**
 * Extract Retry-After timing from an upstream Response as milliseconds.
 * Returns undefined when the header is absent or unparseable.
 */
export function extractRetryAfterMs(response: Response): number | undefined {
  return parseRetryAfterMs(response.headers.get('retry-after'))
}

/**
 * Build the details object for an UpstreamAPIError from a failed upstream
 * Response, including Retry-After guidance when the upstream provides it.
 */
export function buildUpstreamErrorDetails(response: Response, payload: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {
    status: response.status,
    payload,
  }
  const retryAfterMs = extractRetryAfterMs(response)
  if (retryAfterMs !== undefined) {
    details.retryAfterMs = retryAfterMs
  }
  return details
}

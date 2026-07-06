import { UpstreamAPIError } from '../errors'

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

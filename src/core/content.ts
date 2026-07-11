import type { ContentBlock, CacheControlMarker } from './ir'

/**
 * Parse a `data:` URL into its media type and base64/percent-encoded payload.
 * Returns undefined for non-data URLs or malformed inputs.
 */
export function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  if (!url.startsWith('data:')) return undefined
  const commaIdx = url.indexOf(',')
  if (commaIdx === -1) return undefined
  const meta = url.slice(5, commaIdx)
  const data = url.slice(commaIdx + 1)
  const semiIdx = meta.indexOf(';')
  let mediaType = meta
  if (semiIdx !== -1) {
    mediaType = meta.slice(0, semiIdx)
    // isBase64 is intentionally not tracked: image data URLs in LLM APIs are
    // virtually always base64, and callers treat `data` as opaque base64.
  }
  if (!mediaType || mediaType === 'text/plain') {
    // default; leave as-is if explicit
  }
  if (!mediaType) mediaType = 'application/octet-stream'
  return { mediaType, data }
}

/**
 * Convert an OpenAI Chat/Responses `image_url` part (or bare URL string) into
 * a normalized image block.
 */
export function openAIImageUrlToBlock(url: string): ContentBlock | undefined {
  if (!url) return undefined
  const dataUrl = parseDataUrl(url)
  if (dataUrl) {
    return { type: 'image', mediaType: dataUrl.mediaType, data: dataUrl.data }
  }
  // Reject malformed `data:` URLs (no comma / no payload) so they are not
  // forwarded verbatim to the upstream as a bogus URL.
  if (url.startsWith('data:')) return undefined
  return { type: 'image', url }
}

/**
 * Convert an OpenAI `input_image` / `image` part (which may carry `image_url`
 * or `url` + optional `detail`) into a normalized image block.
 */
export function openAIImagePartToBlock(part: Record<string, unknown>): ContentBlock | undefined {
  // `image_url` may be a bare URL string (Chat-style shorthand) or an object
  // `{ url, detail }` (the documented Chat shape). Accept both.
  const imageUrl =
    typeof part.image_url === 'string'
      ? part.image_url
      : typeof part.image_url === 'object' && part.image_url !== null
        ? (part.image_url as Record<string, unknown>).url
        : part.url
  if (typeof imageUrl === 'string') {
    return openAIImageUrlToBlock(imageUrl)
  }
  // Some clients send inline base64 directly under `data` + `media_type`.
  if (typeof part.data === 'string') {
    return {
      type: 'image',
      mediaType: typeof part.media_type === 'string' ? part.media_type : undefined,
      data: part.data,
    }
  }
  return undefined
}

/**
 * Convert an OpenAI `file` / `input_file` part into a normalized document
 * block (for PDFs and other non-image documents).
 */
export function openAIFilePartToBlock(part: Record<string, unknown>): ContentBlock | undefined {
  const file =
    typeof part.file === 'object' && part.file !== null
      ? (part.file as Record<string, unknown>)
      : part
  const fileData = typeof file.file_data === 'string' ? file.file_data : typeof file.data === 'string' ? file.data : undefined
  const fileName = typeof file.filename === 'string' ? file.filename : undefined
  if (fileData) {
    const dataUrl = parseDataUrl(fileData)
    if (dataUrl) {
      return { type: 'document', mediaType: dataUrl.mediaType, data: dataUrl.data }
    }
    // Raw base64 with an explicit media type.
    return {
      type: 'document',
      mediaType: typeof file.media_type === 'string' ? file.media_type : guessMediaType(fileName),
      data: fileData,
    }
  }
  return undefined
}

function guessMediaType(filename: string | undefined): string | undefined {
  if (!filename) return undefined
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.json')) return 'application/json'
  return undefined
}

/**
 * Convert a normalized image/document block back into an OpenAI Chat
 * `image_url` content part. Only images are supported on the Chat wire format;
 * documents fall back to a data URL under `image_url` for tolerant servers,
 * but callers should prefer the Responses path for documents.
 */
export function blockToOpenAIChatContentPart(block: ContentBlock): Record<string, unknown> | undefined {
  if (block.type === 'image') {
    if (block.url) return { type: 'image_url', image_url: { url: block.url } }
    if (block.data) return { type: 'image_url', image_url: { url: `data:${block.mediaType ?? 'image/png'};base64,${block.data}` } }
    return undefined
  }
  if (block.type === 'document') {
    const mediaType = block.mediaType ?? 'application/octet-stream'
    if (block.url) return { type: 'image_url', image_url: { url: block.url } }
    if (block.data) return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${block.data}` } }
    return undefined
  }
  return undefined
}

/**
 * Convert a normalized image/document block into an Anthropic content block.
 */
export function blockToAnthropicContent(block: ContentBlock): Record<string, unknown> | undefined {
  if (block.type === 'image') {
    if (block.data) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mediaType ?? 'image/png', data: block.data },
      }
    }
    if (block.url) {
      return { type: 'image', source: { type: 'url', url: block.url } }
    }
    return undefined
  }
  if (block.type === 'document') {
    if (block.data) {
      return {
        type: 'document',
        source: { type: 'base64', media_type: block.mediaType ?? 'application/pdf', data: block.data },
      }
    }
    if (block.url) {
      return { type: 'document', source: { type: 'url', url: block.url } }
    }
    return undefined
  }
  return undefined
}

/**
 * Parse an Anthropic image/document block into a normalized block.
 */
export function anthropicMediaBlockToNormalized(block: Record<string, unknown>): ContentBlock | undefined {
  const type = typeof block.type === 'string' ? block.type : undefined
  const source = typeof block.source === 'object' && block.source !== null ? (block.source as Record<string, unknown>) : undefined
  if (!source) return undefined

  if (type === 'image') {
    if (source.type === 'base64') {
      return {
        type: 'image',
        mediaType: typeof source.media_type === 'string' ? source.media_type : undefined,
        data: typeof source.data === 'string' ? source.data : undefined,
      }
    }
    if (source.type === 'url') {
      return { type: 'image', url: typeof source.url === 'string' ? source.url : undefined }
    }
    return undefined
  }
  if (type === 'document') {
    if (source.type === 'base64') {
      return {
        type: 'document',
        mediaType: typeof source.media_type === 'string' ? source.media_type : undefined,
        data: typeof source.data === 'string' ? source.data : undefined,
      }
    }
    if (source.type === 'url') {
      return { type: 'document', url: typeof source.url === 'string' ? source.url : undefined }
    }
    return undefined
  }
  return undefined
}

/**
 * Extract an Anthropic cache_control marker from a block, if present.
 */
export function parseCacheControl(block: Record<string, unknown>): CacheControlMarker | undefined {
  const cc = block.cache_control
  if (!cc || typeof cc !== 'object') return undefined
  const record = cc as Record<string, unknown>
  // Only model the 'ephemeral' cache_control flavor. Unknown types (future
  // directives, malformed values) are dropped rather than coerced into an
  // active ephemeral breakpoint, which could trigger unintended caching.
  if (record.type !== 'ephemeral') return undefined
  const ttl = record.ttl === '5m' || record.ttl === '1h' ? record.ttl : undefined
  return { type: 'ephemeral', ttl }
}

/**
 * Walk a nested record along `path` and return the leaf if it is a number.
 * Used to extract OpenAI usage detail fields like
 * `prompt_tokens_details.cached_tokens` defensively.
 */
export function readNestedNumber(record: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = record
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'number' ? current : undefined
}

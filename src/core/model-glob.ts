// Minimal glob → RegExp translator for model-name matching.
// Supports: `*` (any run of chars), `?` (single char), and literal characters.
// Globs are matched case-insensitively against the full target model name.
// Good enough for `gpt-*`, `glm-4*`, `claude-*` style patterns without pulling
// a dependency into the Worker bundle.

function escapeRegExp(ch: string): string {
  return /[/^$.|+()[\]{}\\]/.test(ch) ? `\\${ch}` : ch
}

export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (const ch of pattern) {
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '.'
    else source += escapeRegExp(ch)
  }
  return new RegExp(`^(?:${source})$`, 'i')
}

export function matchesGlob(model: string, pattern: string): boolean {
  return globToRegExp(pattern).test(model)
}

export function matchesAnyGlob(model: string, patterns: readonly string[]): boolean {
  const lower = model.toLowerCase()
  return patterns.some((pattern) => matchesGlob(lower, pattern))
}

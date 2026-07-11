import type { ReasoningConfig } from './ir'

/**
 * Canonical reasoning effort levels, ordered low→high. These are the values
 * the IR carries; each provider maps to/from its native shape.
 */
export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/**
 * Map arbitrary client-provided effort strings (which may include synonyms
 * like 'none', 'auto', or OpenAI's older values) into the canonical set.
 * Returns undefined for unknown / empty values so callers can omit the field.
 */
export function normalizeEffort(raw: unknown): ReasoningConfig['effort'] {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (!value) return undefined
  if (value === 'none' || value === 'off' || value === 'disabled') return 'none'
  if (value === 'auto') return 'auto'
  if ((EFFORT_LEVELS as readonly string[]).includes(value)) return value as EffortLevel
  // Tolerate aliases some clients send.
  if (value === 'light') return 'low'
  if (value === 'default') return 'medium'
  if (value === 'max' || value === 'maximum') return 'xhigh'
  return undefined
}

/**
 * Parse OpenAI Chat/Responses `reasoning_effort` into the IR reasoning config.
 */
export function fromOpenAIReasoningEffort(raw: unknown): ReasoningConfig | undefined {
  const effort = normalizeEffort(raw)
  if (!effort) return undefined
  if (effort === 'none') return { enabled: false }
  return { effort, enabled: true }
}

/**
 * Parse Anthropic `thinking` object into the IR reasoning config.
 *
 * Shapes handled:
 *   { type: 'enabled', budget_tokens: N }
 *   { type: 'disabled' }
 *   { type: 'adaptive' } / { type: 'auto' }
 *   { type: 'enabled' }                 (no budget → auto)
 */
export function fromAnthropicThinking(thinking: unknown): ReasoningConfig | undefined {
  if (!thinking || typeof thinking !== 'object') return undefined
  const record = thinking as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : undefined
  if (!type) return undefined

  if (type === 'disabled') return { enabled: false }
  if (type === 'adaptive' || type === 'auto') return { effort: 'auto', enabled: true }

  if (type === 'enabled') {
    const budget = typeof record.budget_tokens === 'number' ? record.budget_tokens : undefined
    if (budget !== undefined) {
      // A budget of 0 or negative is not a valid Anthropic thinking budget
      // (the minimum is 1024). Treat it as an explicit request to disable
      // thinking rather than forwarding an invalid value.
      if (budget <= 0) return { enabled: false }
      return { budgetTokens: budget, enabled: true, effort: budgetToEffort(budget) }
    }
    return { effort: 'auto', enabled: true }
  }

  return undefined
}

/**
 * Pick an effort level from an explicit token budget. Uses rough bands; the
 * upstream is free to clamp further.
 */
function budgetToEffort(budget: number): ReasoningConfig['effort'] {
  if (budget <= 0) return 'none'
  if (budget < 4000) return 'low'
  if (budget < 16000) return 'medium'
  if (budget < 48000) return 'high'
  return 'xhigh'
}

/**
 * Render the IR reasoning config as an OpenAI `reasoning_effort` string.
 * Returns undefined when unset or when the IR carries only a budget (which
 * has no OpenAI equivalent without a level).
 */
export function toOpenAIReasoningEffort(config: ReasoningConfig | undefined): string | undefined {
  if (!config) return undefined
  if (config.enabled === false) return undefined
  if (config.effort && config.effort !== 'auto' && config.effort !== 'none') return config.effort
  return undefined
}

/**
 * Best-effort budget estimate for an effort level, used when mapping an
 * effort-only config to Anthropic's budget_tokens requirement.
 */
export function effortToBudget(effort: ReasoningConfig['effort']): number | undefined {
  switch (effort) {
    case 'minimal': return 1024
    case 'low': return 4096
    case 'medium': return 16000
    case 'high': return 32000
    case 'xhigh': return 48000
    default: return undefined
  }
}

/**
 * Resolve the IR reasoning config into an Anthropic `thinking` object,
 * deriving a concrete budget when only an effort level was given (Anthropic's
 * `enabled` mode requires budget_tokens).
 *
 * Defensively clamps any sub-minimum budget to Anthropic's 1024-token minimum
 * so an invalid value never reaches the upstream (which would 400).
 */
export function toAnthropicThinkingWithBudget(config: ReasoningConfig | undefined): unknown {
  if (!config) return undefined
  if (config.enabled === false) return { type: 'disabled' }
  const MIN_THINKING_BUDGET = 1024
  const rawBudget = config.budgetTokens ?? effortToBudget(config.effort)
  // No budget is derivable (e.g. effort is 'auto' with no explicit budget, as
  // produced by an Anthropic `thinking:{type:'adaptive'}` or a bare
  // `{type:'enabled'}` with no budget_tokens). Returning `{type:'enabled'}`
  // without budget_tokens is invalid for Anthropic's API (it 400s), so return
  // undefined and let the caller fall back to the raw same-provider
  // `extensions.anthropic.thinking` passthrough, or omit `thinking` cross-provider.
  if (rawBudget === undefined) return undefined
  // Clamp any non-positive budget to the minimum so an invalid value never
  // reaches the upstream (which would 400). This also guards against direct
  // IR construction with enabled:true + budgetTokens:0.
  const budget = Math.max(MIN_THINKING_BUDGET, Math.floor(rawBudget))
  return { type: 'enabled', budget_tokens: budget }
}

import { ConfigurationError } from './errors'
import type { AppEnv } from './env'
import type { UpstreamKind, UpstreamTarget, UpstreamTargetsConfig } from './core/ir'

export type AppConfig = {
  debugRoutesEnabled: boolean
}

export function getConfig(env: AppEnv): AppConfig {
  return {
    debugRoutesEnabled: env['ENABLE_DEBUG_ROUTES'] === 'true',
  }
}

// Matches `<KIND>_<FIELD>_<N>` where KIND is openai|anthropic, FIELD is one of
// the known per-target fields, and N is a 1-based slot index.
const TARGET_VAR_PATTERN = /^(OPENAI|ANTHROPIC)_(BASE|KEY|WIRE|MODEL|AUTH)_(\d+)$/

type TargetKindUpper = 'OPENAI' | 'ANTHROPIC'
type TargetField = 'BASE' | 'KEY' | 'WIRE' | 'MODEL' | 'AUTH'

const KIND_FROM_UPPER: Record<TargetKindUpper, UpstreamKind> = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
}

// Fields that, when any one is present for a slot, make the slot "declared" —
// and then require the slot's mandatory fields to also be present.
const DECLARED_FIELDS: TargetField[] = ['BASE', 'KEY', 'WIRE', 'MODEL', 'AUTH']

// Mandatory field per kind. WIRE is optional and only meaningful for openai.
const MANDATORY_FIELDS: Record<UpstreamKind, TargetField[]> = {
  openai: ['BASE', 'KEY', 'MODEL'],
  anthropic: ['BASE', 'AUTH', 'MODEL'],
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Anthropic-compatible upstreams always speak the /v1/messages path, so the
// relay appends /v1 automatically.  Strip a trailing /v1 from the configured
// base URL so users don't have to include it — and so legacy configs that do
// include it keep working without producing a doubled /v1/v1 prefix.
function normalizeAnthropicBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/i, '')
}

function parseModelGlobs(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

/**
 * True if any `<KIND>_<FIELD>_<N>` env var is set — used to distinguish a
 * genuinely-unconfigured Worker (no targets at all) from one whose targets are
 * simply incomplete.
 */
export function hasUpstreamConfig(env: AppEnv): boolean {
  return Object.keys(env).some((key) => TARGET_VAR_PATTERN.test(key) && env[key])
}

/**
 * Pure parser. Reads `env` once and returns the resolved target lists. Throws
 * a ConfigurationError for any declared slot that is missing a mandatory field.
 */
export function parseUpstreamTargets(env: AppEnv): UpstreamTargetsConfig {
  type PartialSlot = {
    kind: UpstreamKind
    slot: number
    base?: string
    key?: string
    auth?: string
    wire?: string
    model?: string
  }

  const slots = new Map<string, PartialSlot>()

  for (const [key, rawValue] of Object.entries(env)) {
    const match = TARGET_VAR_PATTERN.exec(key)
    if (!match) continue
    const field = match[2] as TargetField
    if (!DECLARED_FIELDS.includes(field)) continue

    const value = rawValue?.trim()
    if (!value) continue

    const kindUpper = match[1] as TargetKindUpper
    const slotNumber = Number.parseInt(match[3], 10)
    const slotKey = `${kindUpper}_${slotNumber}`

    let slot = slots.get(slotKey)
    if (!slot) {
      slot = { kind: KIND_FROM_UPPER[kindUpper], slot: slotNumber }
      slots.set(slotKey, slot)
    }

    if (field === 'BASE') slot.base = value
    else if (field === 'KEY') slot.key = value
    else if (field === 'AUTH') slot.auth = value
    else if (field === 'WIRE') slot.wire = value
    else if (field === 'MODEL') slot.model = value
  }

  const config: UpstreamTargetsConfig = { openai: [], anthropic: [] }

  const ordered = [...slots.values()].sort((a, b) => a.slot - b.slot)
  for (const slot of ordered) {
    const mandatory = MANDATORY_FIELDS[slot.kind]
    const missing = mandatory.filter((field) => {
      if (field === 'BASE') return !slot.base
      if (field === 'KEY') return !slot.key
      if (field === 'AUTH') return !slot.auth
      if (field === 'MODEL') return !slot.model
      return false
    })

    const kindUpper = slot.kind.toUpperCase()
    if (missing.length > 0) {
      throw new ConfigurationError(
        `Upstream target ${kindUpper}_${slot.slot} is missing required field(s): ${missing
          .map((field) => `${kindUpper}_${field}_${slot.slot}`)
          .join(', ')}`,
      )
    }

    const modelGlobs = parseModelGlobs(slot.model ?? '')
    if (modelGlobs.length === 0) {
      throw new ConfigurationError(
        `${kindUpper}_MODEL_${slot.slot} must list at least one model glob`,
      )
    }

    // Reject any glob that reduces to an empty literal — '*', '**', '*?', etc.
    // These match every model, making the target ambiguous against all others.
    const catchAll = modelGlobs.find((glob) => glob.replace(/[?*]/g, '').length === 0)
    if (catchAll) {
      throw new ConfigurationError(
        `${kindUpper}_MODEL_${slot.slot} must not use a bare catch-all glob ('${catchAll}'). ` +
          'It makes the target ambiguous against every other target (every model matches), so the relay would reject every request as ambiguous. ' +
          `Use a broad prefix (e.g. 'gpt-*', 'glm-*') or an explicit comma-separated model list instead.`,
      )
    }

    const baseUrl = slot.kind === 'anthropic'
      ? normalizeAnthropicBaseUrl(slot.base!)
      : normalizeBaseUrl(slot.base!)
    if (!baseUrl) {
      throw new ConfigurationError(
        `${kindUpper}_BASE_${slot.slot} must be a non-empty base URL`,
      )
    }

    const target: UpstreamTarget = {
      slot: slot.slot,
      kind: slot.kind,
      baseUrl,
      modelGlobs,
    }

    if (slot.kind === 'openai') {
      target.apiKey = slot.key
      target.wireApi = slot.wire === 'responses' ? 'responses' : 'chat_completions'
    } else {
      target.authToken = slot.auth
    }

    config[slot.kind].push(target)
  }

  return config
}

/**
 * Resolve and validate the upstream target list for the current request. Throws
 * a ConfigurationError if the Worker declares no targets at all.
 */
export function resolveUpstreamTargets(env: AppEnv): UpstreamTargetsConfig {
  const config = parseUpstreamTargets(env)
  if (config.openai.length === 0 && config.anthropic.length === 0) {
    if (hasUpstreamConfig(env)) {
      throw new ConfigurationError(
        'No complete upstream target is configured. Each target needs BASE, its auth field (KEY or AUTH), and MODEL.',
      )
    }
    throw new ConfigurationError(
      'No upstream targets are configured. Add OPENAI_BASE_1 / OPENAI_KEY_1 / OPENAI_MODEL_1 (and/or ANTHROPIC_BASE_1 / ANTHROPIC_AUTH_1 / ANTHROPIC_MODEL_1) to your Worker environment.',
    )
  }
  return config
}

import { ProviderSelectionError } from '../errors'
import type { NormalizedRequest, ProviderId, UpstreamTarget, UpstreamTargetsConfig } from './ir'
import { matchesAnyGlob } from './model-glob'

/**
 * Resolve the single upstream target for a request. Walks targets in slot
 * order (openai first, then anthropic) and returns the first whose modelGlobs
 * match `targetModel`. `providerHint`, when concrete, restricts the search to
 * targets of that kind. Overlapping matches and zero matches both throw.
 */
export function selectUpstreamTarget(
  request: Pick<NormalizedRequest, 'targetModel' | 'providerHint'>,
  config: UpstreamTargetsConfig,
): UpstreamTarget {
  const model = request.targetModel.toLowerCase()

  const candidateKinds: ProviderId[] =
    request.providerHint && request.providerHint !== 'auto'
      ? [request.providerHint]
      : ['openai', 'anthropic']

  const matched: UpstreamTarget[] = []
  for (const kind of candidateKinds) {
    for (const target of config[kind]) {
      if (matchesAnyGlob(model, target.modelGlobs)) {
        matched.push(target)
      }
    }
  }

  if (matched.length === 0) {
    const declared = describeTargets(config)
    throw new ProviderSelectionError(
      `No upstream target matches model '${request.targetModel}'. Configured targets: ${declared}`,
      { reason: 'no_match' },
    )
  }

  if (matched.length > 1) {
    const conflict = matched
      .map((target) => `${target.kind.toUpperCase()}_${target.slot}(${target.modelGlobs.join('|')})`)
      .join(', ')
    throw new ProviderSelectionError(
      `Model '${request.targetModel}' matches multiple upstream targets: ${conflict}. Disambiguate with narrower model globs or a providerHint.`,
      { reason: 'ambiguous' },
    )
  }

  return matched[0]!
}

// ---------------------------------------------------------------------------
// Model fallback
// ---------------------------------------------------------------------------

/**
 * The model name from the most recent *successful* routing. Used by
 * `selectUpstreamTargetWithFallback` to substitute unknown models (e.g.
 * `gpt-5.4-mini`, which Codex CLI sends internally but no configured upstream
 * serves) with a model that is known to work.
 *
 * This is module-level state, which is acceptable for a single-instance dev
 * relay. In a multi-instance deployment, each instance tracks independently.
 */
let _lastRoutedModel: string | undefined

/** Reset the fallback state. Exposed for testing. */
export function _resetLastRoutedModel(): void {
  _lastRoutedModel = undefined
}

/**
 * Like {@link selectUpstreamTarget}, but when the requested model matches no
 * target, falls back to the last successfully-used model instead of
 * hard-failing.
 *
 * On a successful match (original or fallback), the request's `targetModel`
 * is updated in-place to the effective model name so downstream clients
 * (provider mappers, upstream fetch) see the substituted value.
 *
 * Returns the resolved target and, if a fallback was applied, the original
 * model name so the caller can log the substitution.
 */
export function selectUpstreamTargetWithFallback(
  request: NormalizedRequest,
  config: UpstreamTargetsConfig,
): { target: UpstreamTarget; fallbackFrom?: string } {
  try {
    const target = selectUpstreamTarget(request, config)
    _lastRoutedModel = request.targetModel
    return { target }
  } catch (err) {
    // Only attempt fallback on zero-match errors, not ambiguity errors.
    if (
      err instanceof ProviderSelectionError
      && (err.details as { reason?: string } | undefined)?.reason === 'no_match'
      && _lastRoutedModel
      && _lastRoutedModel.toLowerCase() !== request.targetModel.toLowerCase()
    ) {
      const originalModel = request.targetModel
      request.targetModel = _lastRoutedModel
      try {
        const target = selectUpstreamTarget(request, config)
        return { target, fallbackFrom: originalModel }
      } catch {
        // Fallback model also failed — restore original and throw original error.
        request.targetModel = originalModel
      }
    }
    throw err
  }
}

/**
 * Provider-id view of the resolved target. Used by the debug route, which only
 * needs to report which provider was selected (not the specific target).
 */
export function selectProvider(
  request: Pick<NormalizedRequest, 'targetModel' | 'providerHint'>,
  config: UpstreamTargetsConfig,
): ProviderId {
  return selectUpstreamTarget(request, config).kind
}

function describeTargets(config: UpstreamTargetsConfig): string {
  const all = [...config.openai, ...config.anthropic]
  if (all.length === 0) return '(none)'
  return all
    .map((target) => `${target.kind.toUpperCase()}_${target.slot}=${target.modelGlobs.join(',')}`)
    .join('; ')
}

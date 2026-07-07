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
    )
  }

  if (matched.length > 1) {
    const conflict = matched
      .map((target) => `${target.kind.toUpperCase()}_${target.slot}(${target.modelGlobs.join('|')})`)
      .join(', ')
    throw new ProviderSelectionError(
      `Model '${request.targetModel}' matches multiple upstream targets: ${conflict}. Disambiguate with narrower model globs or a providerHint.`,
    )
  }

  return matched[0]!
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

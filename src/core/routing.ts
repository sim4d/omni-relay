import { ProviderSelectionError } from '../errors'
import type { NormalizedRequest, ProviderId } from './ir'

const OPENAI_MODEL_PREFIXES = ['gpt-', 'o', 'text-embedding-', 'glm-', 'kimi-', 'minimax-']
const ANTHROPIC_MODEL_PREFIXES = ['claude-']

export function selectProvider(request: Pick<NormalizedRequest, 'targetModel' | 'providerHint'>): ProviderId {
  if (request.providerHint && request.providerHint !== 'auto') {
    return request.providerHint
  }

  const model = request.targetModel.toLowerCase()

  if (OPENAI_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))) {
    return 'openai'
  }

  if (ANTHROPIC_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))) {
    return 'anthropic'
  }

  throw new ProviderSelectionError(`Unable to infer provider from model: ${request.targetModel}`)
}

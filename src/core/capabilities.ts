import type { ProviderId } from './ir'

export type FeatureSupport = 'supported' | 'unsupported' | 'deferred'

export type ProviderCapabilities = {
  provider: ProviderId
  streaming: FeatureSupport
  customFunctionTools: FeatureSupport
  reasoningNormalization: FeatureSupport
  multimodalNormalization: FeatureSupport
}

export const PROVIDER_CAPABILITIES: Record<ProviderId, ProviderCapabilities> = {
  openai: {
    provider: 'openai',
    streaming: 'supported',
    customFunctionTools: 'supported',
    reasoningNormalization: 'deferred',
    multimodalNormalization: 'deferred',
  },
  anthropic: {
    provider: 'anthropic',
    streaming: 'supported',
    customFunctionTools: 'supported',
    reasoningNormalization: 'deferred',
    multimodalNormalization: 'deferred',
  },
}

import { UnsupportedFeatureError } from '../errors'
import type { NormalizedRequest } from './ir'

export function assertMilestoneOneFeatureSupport(request: NormalizedRequest): void {
  const hasProviderExtensionBlocks = [request.instructions, ...request.messages.map((message) => message.content)]
    .flat()
    .some((block) => block.type === 'provider_extension')

  if (hasProviderExtensionBlocks) {
    throw new UnsupportedFeatureError(
      'Provider-native extension blocks are not supported for cross-provider translation in MVP',
    )
  }
}

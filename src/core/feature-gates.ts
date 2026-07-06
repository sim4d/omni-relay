import { UnsupportedFeatureError } from '../errors'
import type { NormalizedRequest, ProviderId } from './ir'

export type RouteProtocol = 'chat' | 'responses' | 'messages'

export function assertMilestoneOneFeatureSupport(
  request: NormalizedRequest,
  provider: ProviderId,
  routeProtocol: RouteProtocol,
): void {
  const providerExtensionBlocks = [request.instructions, ...request.messages.map((message) => message.content)]
    .flat()
    .filter((block): block is Extract<(typeof request.instructions)[number], { type: 'provider_extension' }> => block.type === 'provider_extension')

  for (const block of providerExtensionBlocks) {
    if (block.provider !== provider) {
      throw new UnsupportedFeatureError(
        `Provider-native extension block "${block.name}" cannot be translated from ${block.provider} to ${provider} in MVP`,
      )
    }

    if (provider === 'openai' && routeProtocol === 'chat') {
      throw new UnsupportedFeatureError(
        `OpenAI Chat upstream cannot safely preserve provider-native extension block "${block.name}" in MVP`,
      )
    }
  }

  const openAITextConfig = request.extensions?.openai?.text
  if (openAITextConfig && (provider !== 'openai' || routeProtocol !== 'responses')) {
    throw new UnsupportedFeatureError(
      'Structured output via OpenAI Responses text configuration is only supported on the OpenAI Responses same-provider path in MVP',
    )
  }

  const openAICustomTools = request.extensions?.openai?.customTools
  const customToolChoice = request.toolChoice?.type === 'tool' && request.toolChoice.toolType === 'custom'
  if ((Array.isArray(openAICustomTools) && openAICustomTools.length > 0) || customToolChoice) {
    if (provider !== 'openai' || routeProtocol !== 'responses') {
      throw new UnsupportedFeatureError(
        'OpenAI Responses custom tools are only supported on the OpenAI Responses same-provider path in MVP',
      )
    }
  }
}

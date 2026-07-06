import { AuthenticationError, ValidationError } from '../../errors'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectProvider } from '../../core/routing'
import { parseAuthorizationHeader, validateRelayAuthorization } from '../../auth'
import { readJsonBody } from '../../lib/json'
import { jsonResponse } from '../../lib/http'
import { renderOpenAIChatResponse } from './render'
import { parseOpenAIChatRequest } from './parse'
import { invokeOpenAIChat } from '../../providers/openai/client'
import type { AppEnv } from '../../env'
import type { RequestContext } from '../../observability'

export async function handleOpenAIChatCompletions(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const bearer = parseAuthorizationHeader(request)
  if (!validateRelayAuthorization(env, bearer?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseOpenAIChatRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one non-instruction message is required')
  }

  assertMilestoneOneFeatureSupport(normalized)

  const provider = selectProvider(normalized)
  if (provider !== 'openai') {
    throw new ValidationError(`OpenAI Chat route currently only supports OpenAI-routed models, got provider: ${provider}`)
  }

  const result = await invokeOpenAIChat(normalized, env)
  return jsonResponse(renderOpenAIChatResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
    },
  })
}

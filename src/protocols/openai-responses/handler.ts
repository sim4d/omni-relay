import { AuthenticationError, ValidationError } from '../../errors'
import { parseAuthorizationHeader, validateRelayAuthorization } from '../../auth'
import { assertMilestoneOneFeatureSupport } from '../../core/feature-gates'
import { selectProvider } from '../../core/routing'
import type { AppEnv } from '../../env'
import { jsonResponse } from '../../lib/http'
import { readJsonBody } from '../../lib/json'
import type { RequestContext } from '../../observability'
import { invokeOpenAIResponses } from '../../providers/openai/responses-client'
import { parseOpenAIResponsesRequest } from './parse'
import { renderOpenAIResponsesResponse } from './render'

export async function handleOpenAIResponses(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  const bearer = parseAuthorizationHeader(request)
  if (!validateRelayAuthorization(env, bearer?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  const normalized = parseOpenAIResponsesRequest(body)

  if (normalized.messages.length === 0) {
    throw new ValidationError('At least one message is required for the OpenAI Responses route')
  }

  assertMilestoneOneFeatureSupport(normalized)

  const provider = selectProvider(normalized)
  if (provider !== 'openai') {
    throw new ValidationError(`OpenAI Responses route currently only supports OpenAI-routed models, got provider: ${provider}`)
  }

  const result = await invokeOpenAIResponses(normalized, env)
  return jsonResponse(renderOpenAIResponsesResponse(result), {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
    },
  })
}

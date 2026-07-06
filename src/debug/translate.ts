import { AuthenticationError, AuthorizationError, ValidationError } from '../errors'
import { parseRelayCredential, validateRelayAuthorization } from '../auth'
import { selectProvider } from '../core/routing'
import type { AppEnv } from '../env'
import { jsonResponse } from '../lib/http'
import { readJsonBody } from '../lib/json'
import type { RequestContext } from '../observability'
import { parseAnthropicMessagesRequest } from '../protocols/anthropic-messages/parse'
import { parseOpenAIChatRequest } from '../protocols/openai-chat/parse'
import { parseOpenAIResponsesRequest } from '../protocols/openai-responses/parse'

export async function handleDebugTranslate(request: Request, env: AppEnv, requestContext: RequestContext): Promise<Response> {
  if (!env.RELAY_API_KEY) {
    throw new AuthorizationError('Debug route requires RELAY_API_KEY to be configured')
  }

  const credential = parseRelayCredential(request)
  if (!validateRelayAuthorization(env, credential?.token)) {
    throw new AuthenticationError('Invalid relay API key')
  }

  const body = await readJsonBody(request)
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Debug translate body must be a JSON object')
  }

  const record = body as Record<string, unknown>
  const protocol = record.protocol
  const payload = record.payload

  if (protocol !== 'chat' && protocol !== 'responses' && protocol !== 'messages') {
    throw new ValidationError('protocol must be one of: chat, responses, messages')
  }

  const normalized =
    protocol === 'chat'
      ? parseOpenAIChatRequest(payload)
      : protocol === 'responses'
        ? parseOpenAIResponsesRequest(payload)
        : parseAnthropicMessagesRequest(payload)

  const provider = selectProvider(normalized)

  return jsonResponse({
    ok: true,
    protocol,
    provider,
    normalized,
    request_id: requestContext.requestId,
  }, {
    status: 200,
    headers: {
      'x-request-id': requestContext.requestId,
    },
  })
}

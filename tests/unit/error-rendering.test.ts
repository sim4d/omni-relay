import {
  AuthenticationError,
  MethodNotAllowedError,
  renderError,
  UpstreamAPIError,
  ValidationError,
} from '../../src/errors'

describe('error rendering', () => {
  it('renders relay errors as structured JSON', async () => {
    const response = renderError(new ValidationError('bad request', { field: 'model' }), 'req_1')
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(response.headers.get('x-request-id')).toBe('req_1')
    expect((payload.error as Record<string, unknown>).code).toBe('validation_error')
  })

  it('renders auth and method errors with the correct HTTP status', async () => {
    const authResponse = renderError(new AuthenticationError('nope'), 'req_2')
    const methodResponse = renderError(new MethodNotAllowedError('bad method'), 'req_4')

    expect(authResponse.status).toBe(401)
    expect(methodResponse.status).toBe(405)
  })

  it('wraps unknown exceptions as internal relay errors', async () => {
    const response = renderError(new Error('boom'), 'req_5')
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(500)
    expect((payload.error as Record<string, unknown>).code).toBe('internal_error')
  })
})

describe('protocol-specific error rendering', () => {
  it('renders Anthropic-shaped error for messages protocol', async () => {
    const response = renderError(new ValidationError('bad request'), 'req_anthropic', 'messages')
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(payload.type).toBe('error')
    const error = payload.error as Record<string, unknown>
    expect(error.type).toBe('invalid_request_error')
    expect(error.message).toBe('bad request')
    // Anthropic error shape must NOT include code/param/details/request_id
    expect(error.code).toBeUndefined()
    expect(error.param).toBeUndefined()
  })

  it('renders OpenAI-shaped error for chat protocol', async () => {
    const response = renderError(new ValidationError('bad request'), 'req_openai', 'chat')
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(400)
    expect(payload.type).toBeUndefined()
    const error = payload.error as Record<string, unknown>
    expect(error.type).toBe('invalid_request_error')
    expect(error.code).toBe('validation_error')
    expect(error.param).toBeNull()
  })

  it('maps upstream_api_error to api_error type for Anthropic', async () => {
    const response = renderError(new UpstreamAPIError('upstream failed'), 'req_3', 'messages')
    const payload = await response.json() as Record<string, unknown>
    expect((payload.error as Record<string, unknown>).type).toBe('api_error')
  })
})

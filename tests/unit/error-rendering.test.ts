import {
  AuthenticationError,
  MethodNotAllowedError,
  renderError,
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

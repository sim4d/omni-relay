export type RelayErrorCode =
  | 'validation_error'
  | 'authentication_error'
  | 'unsupported_feature'
  | 'provider_selection_error'
  | 'upstream_api_error'
  | 'stream_protocol_error'
  | 'timeout_error'
  | 'internal_error'
  | 'not_found'
  | 'method_not_allowed'
  | 'not_implemented'

export class RelayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: RelayErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

export class ValidationError extends RelayError {
  constructor(message = 'Request validation failed', details?: unknown) {
    super(400, 'validation_error', message, details)
  }
}

export class AuthenticationError extends RelayError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(401, 'authentication_error', message, details)
  }
}

export class UnsupportedFeatureError extends RelayError {
  constructor(message = 'Requested feature is not supported', details?: unknown) {
    super(422, 'unsupported_feature', message, details)
  }
}

export class ProviderSelectionError extends RelayError {
  constructor(message = 'Unable to select an upstream provider', details?: unknown) {
    super(400, 'provider_selection_error', message, details)
  }
}

export class UpstreamAPIError extends RelayError {
  constructor(message = 'Upstream provider request failed', details?: unknown, status = 502) {
    super(status, 'upstream_api_error', message, details)
  }
}

export class StreamProtocolError extends RelayError {
  constructor(message = 'Streaming protocol error', details?: unknown) {
    super(502, 'stream_protocol_error', message, details)
  }
}

export class TimeoutError extends RelayError {
  constructor(message = 'Upstream request timed out', details?: unknown) {
    super(504, 'timeout_error', message, details)
  }
}

export class InternalRelayError extends RelayError {
  constructor(message = 'Internal relay error', details?: unknown) {
    super(500, 'internal_error', message, details)
  }
}

export class ConfigurationError extends RelayError {
  constructor(message = 'Relay configuration error', details?: unknown) {
    super(500, 'internal_error', message, details)
  }
}

export class NotFoundError extends RelayError {
  constructor(message = 'Route not found', details?: unknown) {
    super(404, 'not_found', message, details)
  }
}

export class MethodNotAllowedError extends RelayError {
  constructor(message = 'Method not allowed', details?: unknown) {
    super(405, 'method_not_allowed', message, details)
  }
}

export class NotImplementedError extends RelayError {
  constructor(message = 'Endpoint not implemented yet', details?: unknown) {
    super(501, 'not_implemented', message, details)
  }
}

export type ErrorProtocol = 'chat' | 'responses' | 'messages' | 'generic'

export function isRelayError(error: unknown): error is RelayError {
  return error instanceof RelayError
}

/**
 * Map an internal relay error code to the upstream-style error type string a
 * given protocol expects (e.g. Anthropic's "invalid_request_error").
 */
function errorTypeFor(code: RelayErrorCode, protocol: ErrorProtocol): string {
  if (protocol === 'messages') {
    switch (code) {
      case 'validation_error': return 'invalid_request_error'
      case 'authentication_error': return 'authentication_error'
      case 'unsupported_feature': return 'invalid_request_error'
      case 'provider_selection_error': return 'invalid_request_error'
      case 'upstream_api_error': return 'api_error'
      case 'stream_protocol_error': return 'api_error'
      case 'timeout_error': return 'api_error'
      case 'not_found': return 'not_found_error'
      case 'method_not_allowed': return 'invalid_request_error'
      case 'not_implemented': return 'api_error'
      default: return 'api_error'
    }
  }
  // OpenAI-style clients read `type` loosely; these values are conventional.
  switch (code) {
    case 'validation_error': return 'invalid_request_error'
    case 'authentication_error': return 'authentication_error'
    case 'not_found': return 'invalid_request_error'
    case 'method_not_allowed': return 'invalid_request_error'
    case 'unsupported_feature': return 'invalid_request_error'
    case 'provider_selection_error': return 'invalid_request_error'
    default: return 'api_error'
  }
}

export function renderError(error: unknown, requestId?: string, protocol: ErrorProtocol = 'generic'): Response {
  const relayError = isRelayError(error)
    ? error
    : new InternalRelayError('Unhandled error', {
        cause: error instanceof Error ? error.message : String(error),
      })

  if (protocol === 'messages') {
    // Anthropic error shape.
    return Response.json(
      {
        type: 'error',
        error: {
          type: errorTypeFor(relayError.code, protocol),
          message: relayError.message,
        },
      },
      {
        status: relayError.status,
        headers: {
          'x-request-id': requestId ?? '',
        },
      },
    )
  }

  // OpenAI-style error shape (chat + responses share this).
  return Response.json(
    {
      error: {
        message: relayError.message,
        type: errorTypeFor(relayError.code, protocol),
        code: relayError.code,
        param: null,
        details: relayError.details,
        request_id: requestId,
      },
    },
    {
      status: relayError.status,
      headers: {
        'x-request-id': requestId ?? '',
      },
    },
  )
}

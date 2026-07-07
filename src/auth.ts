import type { AppEnv } from './env'

export type BearerToken = {
  scheme: 'Bearer'
  token: string
}

export type RelayCredential = {
  source: 'authorization' | 'x-api-key'
  token: string
}

export function parseAuthorizationHeader(request: Request): BearerToken | null {
  const value = request.headers.get('authorization')
  if (!value) return null

  const [scheme, token] = value.split(/\s+/, 2)
  if (scheme !== 'Bearer' || !token) return null

  return { scheme: 'Bearer', token }
}

export function parseRelayCredential(request: Request): RelayCredential | null {
  const bearer = parseAuthorizationHeader(request)
  if (bearer) {
    return {
      source: 'authorization',
      token: bearer.token,
    }
  }

  const apiKey = request.headers.get('x-api-key')?.trim()
  if (apiKey) {
    return {
      source: 'x-api-key',
      token: apiKey,
    }
  }

  return null
}

function constantTimeEquals(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)

  if (aBytes.length !== bBytes.length) return false

  let mismatch = 0
  for (let i = 0; i < aBytes.length; i += 1) {
    mismatch |= aBytes[i] ^ bBytes[i]
  }

  return mismatch === 0
}

export function validateRelayAuthorization(env: AppEnv, token?: string): boolean {
  const configuredKey = env.RELAY_API_KEY?.trim()
  if (!configuredKey || !token) {
    return false
  }

  return constantTimeEquals(token, configuredKey)
}

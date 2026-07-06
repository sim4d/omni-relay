import type { AppEnv } from './env'

export type BearerToken = {
  scheme: 'Bearer'
  token: string
}

export function parseAuthorizationHeader(request: Request): BearerToken | null {
  const value = request.headers.get('authorization')
  if (!value) return null

  const [scheme, token] = value.split(/\s+/, 2)
  if (scheme !== 'Bearer' || !token) return null

  return { scheme: 'Bearer', token }
}

export function isAuthenticationConfigured(env: AppEnv): boolean {
  return Boolean(env.RELAY_API_KEY)
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
  if (!isAuthenticationConfigured(env)) {
    return true
  }

  if (!token || !env.RELAY_API_KEY) {
    return false
  }

  return constantTimeEquals(token, env.RELAY_API_KEY)
}

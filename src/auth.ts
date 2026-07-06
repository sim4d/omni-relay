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

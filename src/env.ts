export interface RateLimitResult {
  success: boolean
}

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<RateLimitResult> | RateLimitResult
}

export interface AppEnv {
  ENVIRONMENT: 'development' | 'staging' | 'production' | (string & {})
  OPENAI_BASE_URL?: string
  ANTHROPIC_BASE_URL?: string
  ENABLE_DEBUG_ROUTES?: string
  RELAY_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_AUTH_TOKEN?: string
  RATE_LIMITER?: RateLimiterBinding
}

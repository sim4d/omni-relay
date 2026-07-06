import type { RateLimitCheckRequest, RateLimitCheckResponse } from './rate-limit-do'

export interface RateLimitResult {
  success: boolean
}

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<RateLimitResult> | RateLimitResult
}

export interface RelayRateLimiterDurableObjectNamespace {
  getByName(name: string): {
    checkLimit(request: RateLimitCheckRequest): Promise<RateLimitCheckResponse>
  }
}

export interface AppEnv {
  ENVIRONMENT: 'development' | 'staging' | 'production' | (string & {})
  OPENAI_BASE_URL?: string
  OPENAI_WIRE_API?: 'responses' | 'chat_completions' | (string & {})
  ANTHROPIC_BASE_URL?: string
  ENABLE_DEBUG_ROUTES?: string
  RATE_LIMIT_MAX?: string
  RATE_LIMIT_PERIOD_SECONDS?: string
  RELAY_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_AUTH_TOKEN?: string
  RATE_LIMITER?: RateLimiterBinding
  RELAY_RATE_LIMITER_DO?: RelayRateLimiterDurableObjectNamespace
}

import { ConfigurationError } from '../errors'
import type { AppEnv } from '../env'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function requireOpenAIBaseUrl(env: AppEnv): string {
  if (!env.OPENAI_BASE_URL) {
    throw new ConfigurationError('OPENAI_BASE_URL is required and must point to the configured OpenAI-compatible upstream')
  }

  return normalizeBaseUrl(env.OPENAI_BASE_URL)
}

export function requireAnthropicBaseUrl(env: AppEnv): string {
  if (!env.ANTHROPIC_BASE_URL) {
    throw new ConfigurationError('ANTHROPIC_BASE_URL is required and must point to the configured Anthropic-compatible upstream')
  }

  return normalizeBaseUrl(env.ANTHROPIC_BASE_URL)
}

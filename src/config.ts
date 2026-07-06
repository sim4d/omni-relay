import type { AppEnv } from './env'

export type AppConfig = {
  environment: string
  openaiBaseUrl: string
  anthropicBaseUrl: string
}

export function getConfig(env: AppEnv): AppConfig {
  return {
    environment: env.ENVIRONMENT ?? 'development',
    openaiBaseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1',
  }
}

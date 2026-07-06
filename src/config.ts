import type { AppEnv } from './env'

export type AppConfig = {
  environment: string
  openaiBaseUrl?: string
  anthropicBaseUrl?: string
  debugRoutesEnabled: boolean
  openAIWireApi: 'responses' | 'chat_completions'
}

export function getConfig(env: AppEnv): AppConfig {
  return {
    environment: env.ENVIRONMENT ?? 'development',
    openaiBaseUrl: env.OPENAI_BASE_URL,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
    debugRoutesEnabled:
      env.ENABLE_DEBUG_ROUTES === 'true'
      || ((env.ENVIRONMENT ?? 'development') !== 'production' && env.ENABLE_DEBUG_ROUTES !== 'false'),
    openAIWireApi: env.OPENAI_WIRE_API === 'chat_completions' ? 'chat_completions' : 'responses',
  }
}

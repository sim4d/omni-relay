import type { AppEnv } from './env'

export type AppConfig = {
  debugRoutesEnabled: boolean
  openAIWireApi: 'responses' | 'chat_completions'
}

export function getConfig(env: AppEnv): AppConfig {
  return {
    debugRoutesEnabled: env.ENABLE_DEBUG_ROUTES === 'true',
    openAIWireApi: env.OPENAI_WIRE_API === 'chat_completions' ? 'chat_completions' : 'responses',
  }
}

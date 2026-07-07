export interface AppEnv {
  OPENAI_BASE_URL?: string
  OPENAI_WIRE_API?: 'responses' | 'chat_completions' | (string & {})
  ANTHROPIC_BASE_URL?: string
  ENABLE_DEBUG_ROUTES?: string
  RELAY_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_AUTH_TOKEN?: string
}

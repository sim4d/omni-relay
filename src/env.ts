export interface AppEnv {
  ENVIRONMENT: 'development' | 'staging' | 'production' | (string & {})
  OPENAI_BASE_URL?: string
  ANTHROPIC_BASE_URL?: string
  RELAY_API_KEY?: string
  OPENAI_API_KEY?: string
  ANTHROPIC_API_KEY?: string
}

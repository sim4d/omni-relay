// The Worker runtime injects every binding — plaintext `vars` from wrangler.jsonc
// and encrypted secrets set via `wrangler secret put` — as `env[key]` strings.
// Multi-target support means the binding surface is open-ended (e.g.
// `OPENAI_BASE_1`, `OPENAI_BASE_2`, ...), so we type the bag as a string map
// and validate names explicitly in `src/config.ts`.

export type AppEnv = Record<string, string | undefined>

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./tests/mocks/cloudflare-workers.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
})

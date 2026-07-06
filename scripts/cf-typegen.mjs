import { spawnSync } from 'node:child_process'

function shouldSkipForMacOS() {
  if (process.platform !== 'darwin') return false

  const version = spawnSync('sw_vers', ['-productVersion'], {
    encoding: 'utf8',
  })

  if (version.status !== 0) return false

  const [major = '0', minor = '0'] = version.stdout.trim().split('.')
  const majorNumber = Number(major)
  const minorNumber = Number(minor)

  return majorNumber < 13 || (majorNumber === 13 && minorNumber < 5)
}

if (shouldSkipForMacOS()) {
  console.warn('[omni-relay] Skipping `wrangler types` on unsupported local macOS. Falling back to @cloudflare/workers-types.')
  process.exit(0)
}

const result = spawnSync('npx', ['wrangler', 'types'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

process.exit(result.status ?? 1)

// Standalone Node.js dev server for omni-relay — no wrangler/workerd required.
// Bundles src/index.ts with esbuild, then serves it on plain node:http.
//
// Reads env vars from .dev.vars (same format as wrangler) and process.env,
// with .dev.vars taking precedence.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { build } from 'esbuild'

const PORT = Number(process.env.PORT) || 8787

// ---------------------------------------------------------------------------
// 1. Load .dev.vars (dotenv-style, same format wrangler uses)
// ---------------------------------------------------------------------------
function parseDevVars(raw) {
  const env = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

let devVars = {}
try {
  const raw = await readFile('.dev.vars', 'utf8')
  devVars = parseDevVars(raw)
} catch {
  // .dev.vars is optional; process.env alone is fine
}

const env = { ...process.env, ...devVars }

// ---------------------------------------------------------------------------
// 2. Bundle src/index.ts → plain JS (in-memory, no temp file)
// ---------------------------------------------------------------------------
const result = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  write: false,
  logLevel: 'silent',
})

const code = result.outputFiles[0].text
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const worker = (await import(moduleUrl)).default

// ---------------------------------------------------------------------------
// 3. Start HTTP server
// ---------------------------------------------------------------------------
const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const chunks = []
    for await (const chunk of nodeReq) chunks.push(chunk)
    const bodyBytes = Buffer.concat(chunks)

    const url = new URL(nodeReq.url, `http://127.0.0.1:${PORT}`)

    const request = new Request(url, {
      method: nodeReq.method,
      headers: Object.entries(nodeReq.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(', ') : v,
      ]),
      body: bodyBytes.length > 0 ? bodyBytes : undefined,
    })

    const ctx = { waitUntil(promise) { promise.catch(() => {}) } }

    const response = await worker.fetch(request, env, ctx)

    nodeRes.statusCode = response.status
    response.headers.forEach((value, key) => {
      try { nodeRes.setHeader(key, value) } catch { /* skip restricted headers */ }
    })

    if (response.body) {
      const nodeReadable = Readable.fromWeb(response.body)
      nodeReadable.on("error", (err) => {
        // Log only a safe error class/message; avoid dumping the full response
        // body in case it contains upstream-sensitive data.
        const safe = err instanceof Error ? err.message : String(err)
        console.error("[dev-node] upstream stream error:", safe)
        try { nodeRes.end() } catch {}
      })
      nodeReadable.pipe(nodeRes)
    } else {
      nodeRes.end()
    }
  } catch (err) {
    if (!nodeRes.headersSent) {
      nodeRes.statusCode = 500
      nodeRes.setHeader('content-type', 'application/json')
    }
    nodeRes.end(JSON.stringify({ error: { code: 'internal_error', message: err.message } }))
  }
})

server.listen(PORT, () => {
  console.log(`\n  ⚡ omni-relay running at http://127.0.0.1:${PORT}\n`)
})

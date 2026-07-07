# Troubleshooting & Post-Mortem Recovery

Field guide for the failure modes seen when deploying `omni-relay` to Cloudflare
Workers. The headline lesson: **a successful `wrangler deploy` does not mean the
relay is working.** Always verify routes against the live `*.workers.dev` URL
before declaring done. If tests fail *after* a green deploy, work through the
scenarios below — they are ordered by how often they occur.

## 0. Pre-flight checklist (run before every deploy)

```bash
npm install
npm run cf-typegen
npm run typecheck          # must be clean
npm test                   # all vitest suites pass locally
npx wrangler whoami        # confirm you are logged in to the right account
```

A clean local test run proves the code, not the deployment. Keep going to
section 4 to validate the live worker.

---

## 1. `wrangler dev` fails to start locally (macOS version block)

**Symptom**

```
✘ [ERROR] Unsupported macOS version: The Cloudflare Workers runtime cannot run
on the current version of macOS (12.6.0). The minimum requirement is macOS 13.5.0+.
See https://github.com/cloudflare/workerd?tab=readme-ov-file#running-workerd
```

Also surfaces as a silent exit when backgrounding the process, and as a skipped
`wrangler types` in `npm run cf-typegen` ("Unsupported macOS version ... falling
back to @cloudflare/workers-types").

**Root cause**

`workerd` (the Workers runtime) hard-blocks macOS below 13.5.0. The local
runtime is unavailable; nothing you do to the project fixes this.

**Recovery**

You cannot run the local runtime on this machine. Verify against real Cloudflare
compute instead:

1. Deploy to a throwaway worker so you never touch the production name:
   ```bash
   npx wrangler deploy --name relayx-tryrun
   ```
2. Push the secrets the worker needs (secrets are per-worker, not shared):
   ```bash
   for k in OPENAI_API_1 ANTHROPIC_AUTH_1 RELAY_API_KEY; do
     printf '%s' "$VALUE" | npx wrangler secret put "$k" --name relayx-tryrun
   done
   ```
   Add `OPENAI_API_2`, `ANTHROPIC_AUTH_2`, etc. for each additional target slot you configure.
3. Hit the live URL:
   ```bash
   curl https://relayx-tryrun.sim4d.workers.dev/healthz
   ```
4. When done, delete it:
   ```bash
   npx wrangler delete --name relayx-tryrun
   ```
   (`relayx-tryrun` is not real — substitute any unused name; `--remote` mode
   hits the same macOS block for the local proxy, so prefer a throwaway deploy.)

If you must use local dev, run in a DevContainer / Linux host with glibc 2.35+.

---

## 2. `wrangler deploy` fails: stale Durable Object migration (`code: 10064`)

**Symptom**

```
✘ [ERROR] A request to the Cloudflare API (.../workers/scripts/relayx/versions) failed.
New version of script does not export class 'RelayRateLimiter' which is depended on
by existing Durable Objects. Did you forget to include it? If you renamed it, try a
rename-class migration. If you want to delete all the Durable Objects implemented by
the class, you can use a delete-class migration [code: 10064]
```

**Root cause**

An earlier `wrangler.jsonc` registered a Durable Object class via a
`new_sqlite_classes` migration. Removing the class from the code does **not**
retire it on Cloudflare — the platform still expects the export. The deploy is
rejected until you explicitly delete the class with a migration.

**Recovery (the exact fix that worked here)**

1. Add a `deleted_classes` migration to `wrangler.jsonc` (note: it is
   `deleted_classes`, **not** `deleted_sqlite_classes` — the latter is rejected
   with `Unexpected fields found in migrations field: "deleted_sqlite_classes"`):
   ```jsonc
   "migrations": [
     {
       "tag": "v2",
       "deleted_classes": [
         "RelayRateLimiter"
       ]
     }
   ]
   ```
2. Validate the JSON before deploying:
   ```bash
   python3 -c "import json; json.load(open('wrangler.jsonc'))"
   ```
3. Redeploy:
   ```bash
   npx wrangler deploy
   ```
4. Commit the `wrangler.jsonc` change — it is required infrastructure, not local
   state.

If you only renamed the class, use `renamed_classes` instead. If you changed the
storage backend, use `transferred_classes`.

---

## 3. Upstream auth fails after a successful deploy (dummy/placeholder secrets)

**Symptom**

Deploy reports success, but live calls return upstream errors:

```
# OpenAI routes
{"error":{"code":"upstream_api_error","message":"Upstream provider returned non-JSON response",
  "details":{"status":502,"bodyPreview":"error code: 502\n"}}}

# Anthropic routes
{"error":{"code":"upstream_api_error","message":"Anthropic upstream request failed",
  "details":{"status":404,"payload":null}}}
```

A direct probe of the upstream confirms the cause:

```bash
curl https://<ANTHROPIC_BASE_1>/messages \
  -H "Authorization: Bearer <token>" -H "anthropic-version: 2023-06-01"
# => {"error":"Invalid API key"}   (HTTP 401)
```

**Root cause**

The relay forwarded the request correctly; the **upstream rejected the stored
credential**. This happens whenever the deployed `OPENAI_API_<N>` /
`ANTHROPIC_AUTH_<N>` are placeholder values (e.g. `dev-openai-key`,
`my-sk-dummy`, or left as a test key). Code 10064 / deploy success gives no
signal about secret *values* — secrets are write-only and `wrangler secret list`
shows names only.

**How to tell relay-vs-upstream failure apart**

- `401 authentication_error` with message `Invalid relay API key` → **relay auth**
  (RELAY_API_KEY unset or request credential wrong). See section 5.
- `502`/`404`/`401` wrapped in `upstream_api_error` with an `upstream` status in
  `details` → **upstream rejected the forwarded call**. The relay worked.
- `400 validation_error` before any upstream status → request body failed relay
  schema validation (correct behavior).
- `400 provider_selection_error` (model matches no target glob, or matches more
  than one) → **target glob misconfiguration**. Widen/narrow `OPENAI_MODEL_<N>`
  / `ANTHROPIC_MODEL_<N>`, or send `providerHint`.

**Recovery**

1. Set real upstream secrets (write-only; you must paste the real value):
   ```bash
   printf '%s' "$REAL_OPENAI_KEY" | npx wrangler secret put OPENAI_API_1
   printf '%s' "$REAL_ANTHROPIC_TOKEN" | npx wrangler secret put ANTHROPIC_AUTH_1
   ```
2. Re-test the same route; a valid upstream key returns `200` with a model reply.
3. If you only need to prove the relay path (not real inference), any non-empty
   upstream secret is enough to get past the relay's `OPENAI_API_<N>` /
   `ANTHROPIC_AUTH_<N>` required-checks; the upstream will still 401/404, which
   still confirms translation + forwarding + error rendering.

---

## 4. Live verification playbook (run after every deploy)

```bash
BASE="https://relayx.sim4d.workers.dev"
K="<RELAY_API_KEY>"

# Control plane — must work with no/any key
curl -w " [%{http_code}]\n" "$BASE/healthz"                                  # 200
curl -w " [%{http_code}]\n" -X POST "$BASE/healthz"                          # 405
curl -w " [%{http_code}]\n" "$BASE/nonexistent"                             # 404

# Fail-closed relay auth — no key and wrong key both 401
curl -w " [%{http_code}]\n" -X POST "$BASE/v1/chat/completions" \
  -H 'content-type: application/json' -d '{"model":"gpt-5-mini","messages":[]}'   # 401
curl -w " [%{http_code}]\n" -X POST "$BASE/v1/chat/completions" \
  -H 'content-type: application/json' -H 'authorization: Bearer wrong' \
  -d '{"model":"gpt-5-mini","messages":[]}'                                     # 401

# Authenticated data path — reaches upstream (200 only with real upstream key)
curl -w " [%{http_code}]\n" -X POST "$BASE/v1/chat/completions" \
  -H 'content-type: application/json' -H "authorization: Bearer $K" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}'       # 502 if dummy upstream key
curl -w " [%{http_code}]\n" -X POST "$BASE/v1/messages" \
  -H 'content-type: application/json' -H "x-api-key: $K" \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-sonnet-4-0","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'  # 404 if dummy upstream key

# Debug route gate — 404 unless ENABLE_DEBUG_ROUTES=true
curl -w " [%{http_code}]\n" -X POST "$BASE/v1/debug/translate" \
  -H 'content-type: application/json' -H "authorization: Bearer $K" -d '{}'     # 404
```

Interpretation:
- A `502`/`404`/`401` wrapped in `upstream_api_error` = **relay is fine, upstream
  key is bad** (section 3).
- A `401 authentication_error` = relay key problem (section 5).
- A `400 validation_error` = request shape problem (usually your test payload).

---

## 5. Relay auth edge cases (fail-closed)

The relay is **fail-closed**: if `RELAY_API_KEY` is unset or the request
credential does not match, every data route returns `401`. Common gotchas:

- **`/healthz` stays open** (no key needed) — by design.
- **Wrong casing / scheme**: relay accepts `Authorization: Bearer <key>` (OpenAI
  style) or `x-api-key: <key>` (Anthropic style). Anything else → `401`.
- **Secret propagation delay**: after `wrangler secret put`, the new value can
  take a few seconds to apply. If a freshly-set valid key still 401s, wait ~10s
  and retry before assuming a code bug.
- **`ENVIRONMENT` / staging removed**: there is no longer a "debug routes on by
  default in non-prod" mode. `ENABLE_DEBUG_ROUTES` must be explicitly `true`.
  Deploy it as a var or set it to verify debug routes:
  ```bash
  npx wrangler deploy --var ENABLE_DEBUG_ROUTES:true
  # or persist in wrangler.jsonc under "vars"
  ```

---

## 6. Quick decision tree

```
wrangler dev won't start?
  └─ macOS < 13.5 block → deploy a throwaway worker, test live, delete it (§1)

wrangler deploy errors with code 10064?
  └─ stale DO class → add deleted_classes migration, redeploy (§2)

deploy succeeds but tests fail?
  ├─ 401 "Invalid relay API key" → RELAY_API_KEY issue (§5)
  ├─ 502/404 wrapped in upstream_api_error → upstream key bad (§3)
  └─ 400 validation_error → request payload issue (§4)

Local tests green but live weird?
  └─ secret propagation delay → wait 10s, retry (§5)
```

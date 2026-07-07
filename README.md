# omni-relay

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-green)](https://openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A universal LLM API relay and protocol translator for OpenAI and Anthropic, built for Cloudflare Workers.

## Project goal

Let **Codex CLI** and **Claude CLI** share one relay while either client can target either an **OpenAI-compatible** or **Anthropic-compatible** upstream, in both directions:

- OpenAI-style clients/routes onto Anthropic upstreams
- Anthropic-style clients/routes onto OpenAI upstreams

Live verification targets:

- `POST /v1/responses` → any configured upstream whose model glob matches
- `POST /v1/messages` → any configured upstream whose model glob matches
- `POST /v1/chat/completions` → any configured upstream whose model glob matches

Relay auth is client-compatible: `Authorization: Bearer <relay-key>` for OpenAI clients, `x-api-key: <relay-key>` for Anthropic clients.

### Backend compatibility

Backend selection is a configuration and routing concern, not a client lock-in. Known-compatible base URLs:

- Anthropic-compatible: `https://open.bigmodel.cn/api/anthropic`
- OpenAI-compatible: `https://open.bigmodel.cn/api/coding/paas/v4`

For cross-provider calls, set `providerHint` in the request body when model-glob routing alone is not enough (e.g. a model glob that could match targets in both providers, or to force one provider kind for a request).

## Quick Start

Deploy `omni-relay` to Cloudflare Workers compute straight from the Cloudflare dashboard — no local toolchain required. All you need is a Cloudflare account and a copy of the repository under your own Git provider.

1. **Fork or import the repository**

   Fork `omni-relay` into your own GitHub or GitLab account so the dashboard can build from it.

2. **Create the Worker from the dashboard**

   Open the [Cloudflare dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Import a repository** (Workers Builds).

3. **Connect your Git account**

   Authorize Cloudflare to access your Git provider, then select your forked `omni-relay` repository.

4. **Confirm the build settings**

   - **Project name:** `relayx` (or your preferred worker name)
   - **Production branch:** `main`
   - **Build command:** `npm install && npm run cf-typegen`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`

5. **Add environment variables before the first build**

   In **Settings** → **Variables and Secrets**, add the values from the [Environment variables](#environment-variables) section below. The relay routes each request to an upstream **target** by matching the request's `model` against per-target model globs, so you configure one or more targets — add a second OpenAI target with `OPENAI_BASE_2`/`OPENAI_API_2`/`OPENAI_MODEL_2` to fan requests out across multiple upstreams. The relay never falls back to `api.openai.com` or `api.anthropic.com`; it only calls the URLs you configure.

6. **Save and Deploy**

   Select **Save and Deploy**. Workers Builds installs dependencies, runs the build, and executes `wrangler deploy` for you. All configuration comes from `wrangler.jsonc`, so there are no bindings or migrations to set up manually.

7. **Verify it is live**

   Once deployed, hit the worker's health endpoint:

   ```bash
   curl https://<worker>.workers.dev/healthz
   ```

   See [Verify](#verify) below for sample requests in both protocol directions.

See [`docs/troubleshoot.md`](docs/troubleshoot.md) for deploy-time failures (macOS runtime block, stale Durable Object migrations, post-deploy verification).

### Environment variables

In the dashboard these are configured under **Settings** → **Variables and Secrets**. Plaintext vars mirror the `vars` block in `wrangler.jsonc`; sensitive keys are stored as the **Secret** type.

The relay supports **multiple upstream targets per provider**. Each target is a numbered slot (`<N>` = 1, 2, 3, …) carrying its own base URL, key, and the model globs it serves. A request is routed to the target whose `model` glob matches first. Add as many slots as you need.

**OpenAI-compatible targets** (`<N>` = slot number):

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `OPENAI_BASE_<N>` | **Required** | Plaintext | Base URL of this OpenAI-compatible upstream. No built-in fallback. |
| `OPENAI_API_<N>` | **Required** | Secret | `Authorization: Bearer` key sent to this upstream. |
| `OPENAI_MODEL_<N>` | **Required** | Plaintext | Comma-separated model globs this target serves, e.g. `gpt-*,glm-4*`. |
| `OPENAI_WIRE_<N>` | Optional | Plaintext | Wire format: `chat_completions` (default) or `responses`. Set `responses` only when this upstream speaks the Responses API. |

**Anthropic-compatible targets**:

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `ANTHROPIC_BASE_<N>` | **Required** | Plaintext | Base URL of this Anthropic-compatible upstream. No built-in fallback. |
| `ANTHROPIC_AUTH_<N>` | **Required** | Secret | `Authorization: Bearer` token sent to this upstream. |
| `ANTHROPIC_MODEL_<N>` | **Required** | Plaintext | Comma-separated model globs this target serves, e.g. `claude-*`. |

**Relay-wide variables**:

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `RELAY_API_KEY` | **Required** | Secret | Shared key protecting relay routes and `/v1/debug/translate`. |
| `ENABLE_DEBUG_ROUTES` | Optional | Plaintext | `true`/`false`. Disabled unless explicitly set to `true`. |

At least one target (`OPENAI_BASE_1` + `OPENAI_API_1` + `OPENAI_MODEL_1`, or the Anthropic equivalent) is required.

**Routing in brief:** the relay matches the request's `model` against each target's comma-separated globs (e.g. `OPENAI_MODEL_1="glm-5.2,kimi-2.7"`). Exactly one target must match:

- **No match** → `400 provider_selection_error` (model isn't served by any target).
- **More than one match** → `400 provider_selection_error` (ambiguous; the relay never guesses). Keep globs disjoint across targets, or send `providerHint` to narrow by provider kind.
- **Bare `*` catch-all is rejected** at deploy time — it would make its target match every model and thus conflict with all others. Use a broad prefix (`gpt-*`, `glm-*`) or an explicit list instead.

See [`docs/routing.md`](docs/routing.md) for the full model, resolution rules, and worked examples.

## Development

The Worker deploys via Wrangler. Configure secrets first, then build, test, and deploy.

### Secrets

```bash
npx wrangler secret put OPENAI_API_1
npx wrangler secret put ANTHROPIC_AUTH_1
npx wrangler secret put RELAY_API_KEY
# repeat per additional target: OPENAI_API_2, ANTHROPIC_AUTH_2, ...
```

- `OPENAI_API_<N>` — bearer key for the Nth OpenAI-compatible upstream
- `ANTHROPIC_AUTH_<N>` — bearer token for the Nth Anthropic-compatible upstream
- `RELAY_API_KEY` — required; protects relay routes and `/v1/debug/translate`. All requests return 401 if the key is unset or the credential does not match.

Plaintext per-target fields (`OPENAI_BASE_<N>`, `OPENAI_MODEL_<N>`, `OPENAI_WIRE_<N>`, `ANTHROPIC_BASE_<N>`, `ANTHROPIC_MODEL_<N>`) go in the `vars` block of `wrangler.jsonc` (or the dashboard **Variables** section), not in `wrangler secret put`.

### Build, test, deploy

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npx wrangler deploy
```

### Runtime config

- `nodejs_compat` is **not enabled**; the relay uses only platform-native Web APIs.
- Every upstream call requires a fully-configured target: `OPENAI_BASE_<N>` + `OPENAI_API_<N>` + `OPENAI_MODEL_<N>` (or the Anthropic equivalent). There is no fallback to `api.openai.com` or `api.anthropic.com` — only the configured compatible upstreams are used.

### Migrating from V1 (singular keys) to V1.1 (per-target slots)

This release replaces the single-key/single-URL vars with per-target slots. Map your existing config:

| Old (V1) | New (V1.1) |
| --- | --- |
| `OPENAI_BASE_URL` | `OPENAI_BASE_1` |
| `OPENAI_API_KEY` (secret) | `OPENAI_API_1` (secret) |
| `OPENAI_WIRE_API='responses'` | `OPENAI_WIRE_1='responses'` (omit for `chat_completions`) |
| `OPENAI_WIRE_API` unset | (omit `OPENAI_WIRE_1`) |
| `ANTHROPIC_BASE_URL` | `ANTHROPIC_BASE_1` |
| `ANTHROPIC_AUTH_TOKEN` (secret) | `ANTHROPIC_AUTH_1` (secret) |
| `ANTHROPIC_API_KEY` (secret) | `ANTHROPIC_AUTH_1` (secret) — the `x-api-key` path is removed; Bearer only |
| _(new)_ | `OPENAI_MODEL_1` / `ANTHROPIC_MODEL_1` — required model globs |

After renaming, delete the old secret bindings (`wrangler secret delete OPENAI_API_KEY`, etc.) so they do not linger in the dashboard.

### Verify

These examples assume slot 1 of each kind is configured with globs covering the model used (`glm-4.7` on the Anthropic target, `glm-5.2` on the OpenAI target). Adjust the model to one your globs match.

```bash
# Health
curl https://<worker>.workers.dev/healthz

# OpenAI Responses → Anthropic upstream (model glob matches ANTHROPIC_MODEL_1)
curl https://<worker>.workers.dev/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <relay-key>' \
  -d '{"providerHint":"anthropic","model":"glm-4.7","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: omni relay ok"}]}]}'

# Anthropic Messages → OpenAI upstream (model glob matches OPENAI_MODEL_1)
curl https://<worker>.workers.dev/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: <relay-key>' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"providerHint":"openai","model":"glm-5.2","max_tokens":256,"messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

Use a preview deployment first when changing bindings, migrations, or upstream base URLs; promote to production only after compute verification succeeds.

```bash
npx wrangler versions list
npx wrangler rollback   # if a deploy needs reversing
```


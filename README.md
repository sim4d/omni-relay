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

- `POST /v1/responses` → Anthropic upstream
- `POST /v1/messages` → OpenAI upstream
- `POST /v1/chat/completions` → either upstream where compatible

Relay auth is client-compatible: `Authorization: Bearer <relay-key>` for OpenAI clients, `x-api-key: <relay-key>` for Anthropic clients.

### Backend compatibility

Backend selection is a configuration and routing concern, not a client lock-in. Known-compatible base URLs:

- Anthropic-compatible: `https://open.bigmodel.cn/api/anthropic`
- OpenAI-compatible: `https://open.bigmodel.cn/api/coding/paas/v4`

For cross-provider calls, set `providerHint` in the request body when model-prefix auto-routing is not enough.

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

   In **Settings** → **Variables and Secrets**, add the values from the [Environment variables](#environment-variables) table below. Use type **Plaintext** for base URLs and tuning vars, and **Secret** for API keys. Both `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are required — the relay never falls back to `api.openai.com` or `api.anthropic.com`, it only calls the URLs you configure.

6. **Save and Deploy**

   Select **Save and Deploy**. Workers Builds installs dependencies, runs the build, and executes `wrangler deploy` for you. All configuration comes from `wrangler.jsonc`, so there are no bindings or migrations to set up manually.

7. **Verify it is live**

   Once deployed, hit the worker's health endpoint:

   ```bash
   curl https://<worker>.workers.dev/healthz
   ```

   See [Verify](#verify) below for sample requests in both protocol directions.

### Environment variables

In the dashboard these are configured under **Settings** → **Variables and Secrets**. Plaintext vars mirror the `vars` block in `wrangler.jsonc`; sensitive keys are stored as the **Secret** type.

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `OPENAI_BASE_URL` | **Required** | Plaintext | Base URL of the OpenAI-compatible upstream. No built-in fallback. |
| `ANTHROPIC_BASE_URL` | **Required** | Plaintext | Base URL of the Anthropic-compatible upstream. No built-in fallback. |
| `OPENAI_API_KEY` | **Required if `OPENAI_BASE_URL` is set** | Secret | Bearer key sent to the OpenAI upstream for OpenAI-routed requests. |
| `ANTHROPIC_AUTH_TOKEN` | **Required if `ANTHROPIC_BASE_URL` is set** | Secret | Anthropic `Authorization: Bearer` token for the Anthropic upstream. |
| `RELAY_API_KEY` | **Required** | Secret | Shared key protecting relay routes and `/v1/debug/translate`. |
| `OPENAI_WIRE_API` | Optional | Plaintext | OpenAI wire format: `chat_completions` (default) or `responses`. |
| `ENABLE_DEBUG_ROUTES` | Optional | Plaintext | `true`/`false`. Disabled unless explicitly set to `true`. |

## Development

The Worker deploys via Wrangler. Configure secrets first, then build, test, and deploy.

### Secrets

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_AUTH_TOKEN
npx wrangler secret put RELAY_API_KEY
```

- `OPENAI_API_KEY` — OpenAI-routed `/v1/chat/completions`, `/v1/responses`, and OpenAI cross-provider requests
- `ANTHROPIC_AUTH_TOKEN` — Anthropic-routed `/v1/messages` and Anthropic cross-provider requests
- `RELAY_API_KEY` — required; protects relay routes and `/v1/debug/translate`. All requests return 401 if the key is unset or the credential does not match.

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
- `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are **required** runtime vars for any upstream call. There is no fallback to `api.openai.com` or `api.anthropic.com` — only the configured compatible upstreams are used.

### Verify

```bash
# Health
curl https://<worker>.workers.dev/healthz

# OpenAI Responses → Anthropic upstream
curl https://<worker>.workers.dev/v1/responses \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <relay-key>' \
  -d '{"providerHint":"anthropic","model":"glm-4.7","input":[{"role":"user","content":[{"type":"input_text","text":"Reply with exactly: omni relay ok"}]}]}'

# Anthropic Messages → OpenAI upstream
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


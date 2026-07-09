# omni-relay

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-8A2BE2?logo=cloudflare)](https://workers.cloudflare.com/)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-green)](https://openai.com/)
[![Anthropic Compatible](https://img.shields.io/badge/Anthropic-Compatible-red)](https://anthropic.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A universal LLM API relay and protocol translator for OpenAI and Anthropic, built for Cloudflare Workers.

## Project goal

Let **Codex CLI** connect to an **OpenAI-compatible** upstream backend, and translate /v1/responses calls to /v1/chat/completions. Let **Codex CLI** and **Claude CLI** share one relay while either client can target either an **OpenAI-compatible** or **Anthropic-compatible** upstream, in both directions:

- OpenAI-style clients/routes onto Anthropic upstreams
- Anthropic-style clients/routes onto OpenAI upstreams

## Quick Start

Run `omni-relay` locally with a single OpenAI-compatible upstream target.

1. **Clone the project**

   ```bash
   git clone https://github.com/sim4d/omni-relay.git
   cd omni-relay
   npm install
   ```

2. **Create a `.dev.vars` file for local secrets**

   ```bash
   cat > .dev.vars <<'EOF'
   OPENAI_BASE_1="https://openrouter.ai/api/v1"
   OPENAI_KEY_1="<your-openai-compatible-upstream-key>"
   OPENAI_MODEL_1="nvidia/nemotron-3-super-120b-a12b:free"
   RELAY_API_KEY="<your-relay-api-key>"
   EOF
   ```

3. **Run the project on localhost**

   ```bash
   npm run dev:node
   ```

   > `npm run dev:node` runs the relay on plain Node.js — no wrangler/workerd
   > required. Use `npm run dev` if you prefer the wrangler dev server.
   > Keep this terminal running. Open a **new terminal** for the remaining steps.
   > The default port is `8787`.

4. **Verify the local server**

   ```bash
   curl http://127.0.0.1:8787/healthz
   ```

5. **Create a Codex CLI profile**

   Create `~/.codex/relay.config.toml`:

   ```toml
   model = "nvidia/nemotron-3-super-120b-a12b:free"
   model_provider = "relay"
   
   [model_providers.relay]
   name = "relay"
   base_url = "http://127.0.0.1:8787/v1"
   wire_api = "responses"
   env_key = "RELAY_API_KEY"
   ```

6. **Export the relay key into your shell, then start Codex**

   ```bash
   export RELAY_API_KEY="<your-relay-api-key>"
   codex -p relay
   ```

   > Codex reads `env_key` from the OS environment, not from `.dev.vars`.
   > The value must match what you put in `.dev.vars` in step 2.

## Deploy Cloudflare Workers

Deploy `omni-relay` to Cloudflare Workers compute straight from the Cloudflare dashboard.

1. **Fork or import the repository**

   Fork `omni-relay` into your own GitHub account.

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

   In **Settings** → **Variables and Secrets**, add the values from the [Environment variables](#environment-variables) section below. 

6. **Save and Deploy**

   Select **Save and Deploy**. Workers Builds installs dependencies, runs the build, and executes `wrangler deploy` for you. 

7. **Verify it is live**

   Once deployed, hit the worker's health endpoint:

   ```bash
   curl https://<project-name>.<user-id>.workers.dev/healthz
   ```

   See [Verify](#verify) below for sample requests in both protocol directions.

See [`docs/troubleshoot.md`](docs/troubleshoot.md) for deploy-time failures and post-deploy verification.

### Environment variables

In the dashboard these are configured under **Settings** → **Variables and Secrets**. 

The relay supports **multiple upstream targets per compatible category**. Each target is a numbered slot (`<N>` = 1, 2, 3, …) carrying its own base URL, key, and the model globs it serves. 

**Note:** At least one target (`OPENAI_BASE_1` + `OPENAI_KEY_1` + `OPENAI_MODEL_1`), or the Anthropic equivalent, is required.

**OpenAI-compatible targets** (`<N>` = slot number):

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `OPENAI_BASE_<N>` | **Required** | Plaintext | e.g., `https://open.bigmodel.cn/api/coding/paas/v4` |
| `OPENAI_KEY_<N>` | **Required** | Secret | `sk-<key>` |
| `OPENAI_MODEL_<N>` | **Required** | Plaintext | Comma-separated model globs, e.g. `glm-*`. |
| `OPENAI_WIRE_<N>` | Optional | Plaintext | Wire format: `chat_completions` (default) or `responses`. Set `responses` only when this upstream speaks the Responses API. |

**Anthropic-compatible targets**:

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `ANTHROPIC_BASE_<N>` | **Required** | Plaintext | e.g., `https://open.bigmodel.cn/api/anthropic/v1` |
| `ANTHROPIC_AUTH_<N>` | **Required** | Secret | `sk-<key>` |
| `ANTHROPIC_MODEL_<N>` | **Required** | Plaintext | Comma-separated model globs, e.g. `glm-*`. |

**NOTE**: please make sure to add '/v1' to the baseurl

**Relay-wide variables**:

| Variable | Required | Type | Description |
| --- | :---: | --- | --- |
| `RELAY_API_KEY` | **Required** | Secret | `sk-<my-complex-key>` |
| `ENABLE_DEBUG_ROUTES` | Optional | Plaintext | `true`/`false`. Disabled unless explicitly set to `true`. |



**Routing in brief:** the relay matches the request's `model` against each target's comma-separated globs (e.g. `OPENAI_MODEL_1="glm-5.2,kimi-2.7"`). Exactly one target must match, see [`docs/routing.md`](docs/routing.md) for the full model, resolution rules, and worked examples.

## Development

The Worker deploys via Wrangler. Configure secrets first, then build, test, and deploy.

### Clone project

```bash
git clone https://github.com/sim4d/omni-relay.git
cd omni-relay
```

### Set vars and secrets

```bash
npx wrangler secret put OPENAI_KEY_1
npx wrangler secret put ANTHROPIC_AUTH_1
npx wrangler secret put RELAY_API_KEY
# repeat per additional target: OPENAI_KEY_2, ANTHROPIC_AUTH_2, ...
```

- `OPENAI_KEY_<N>` — bearer key for the Nth OpenAI-compatible upstream
- `ANTHROPIC_AUTH_<N>` — bearer token for the Nth Anthropic-compatible upstream
- `RELAY_API_KEY` — required; protects relay routes and `/v1/debug/translate`. All requests return 401 if the key is unset or the credential does not match.

Plaintext vars mirror the `vars` block in [`wrangler.jsonc`](wrangler.jsonc); sensitive keys are stored as the **Secret** type.


### Build, test, deploy

```bash
npm install
npm run cf-typegen
npm run typecheck
npm test
npx wrangler deploy
```

### Verify

Replace `<model>` with one that matches your configured globs.

```bash
# Health
curl https://<project-name>.<user-id>.workers.dev/healthz

# OpenAI Chat Completions → OpenAI upstream
curl https://<project-name>.<user-id>.workers.dev/v1/chat/completions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <relay-key>' \
  -d '{"model":"<model>","messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'

# Anthropic Messages → OpenAI upstream (cross-protocol translation)
curl https://<project-name>.<user-id>.workers.dev/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: <relay-key>' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"<model>","max_tokens":256,"messages":[{"role":"user","content":"Reply with exactly: omni relay ok"}]}'
```

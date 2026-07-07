# Request routing

How the relay decides which configured upstream target serves a given request.

## The model in one sentence

Each request is routed to an upstream **target** by matching the request's `model` field against the comma-separated globs declared in that target's `OPENAI_MODEL_<N>` or `ANTHROPIC_MODEL_<N>` env var. The relay never speculatively calls an upstream to discover routing — the decision is made entirely from config, before any network call.

## Targets

A target is a numbered slot (`<N>` = 1, 2, 3, …) of one provider kind:

- **OpenAI-compatible**: `OPENAI_BASE_<N>` + `OPENAI_API_<N>` + `OPENAI_MODEL_<N>`, plus optional `OPENAI_WIRE_<N>`.
- **Anthropic-compatible**: `ANTHROPIC_BASE_<N>` + `ANTHROPIC_AUTH_<N>` + `ANTHROPIC_MODEL_<N>`.

You may configure any number of each. Slot numbers are 1-based and need not be contiguous, but they are walked in ascending numeric order within each kind.

## Model globs

`OPENAI_MODEL_<N>` / `ANTHROPIC_MODEL_<N>` hold a comma-separated list of globs the target serves. Matching is case-insensitive and applies to the **full** model name.

- `*` — wildcard run of characters within a glob (e.g. `gpt-*` matches `gpt-5-mini`, `gpt-4o`).
- `?` — single character.
- Everything else matches literally.

Each entry is an independent glob; a model matches the target if it matches **any** one of them.

### Examples

| `MODEL_<N>` value | Matches | Does not match |
| --- | --- | --- |
| `gpt-*` | `gpt-5-mini`, `GPT-4o` | `glm-5.2` |
| `glm-5.2,kimi-2.7` | `glm-5.2`, `kimi-2.7`, `GLM-5.2` | `glm-5.1`, `kimi-2.8` |
| `glm-*,kimi-2.7` | `glm-5.2`, `glm-4.7`, `kimi-2.7` | `kimi-2.8` |
| `claude-*` | `claude-sonnet-4-0`, `claude-opus-4` | `gpt-5` |

## Resolution rules

For an incoming request with model `M` (and optional `providerHint`):

1. **`providerHint` narrows the provider kind.** If the request body carries `providerHint: "openai"` or `"anthropic"`, only targets of that kind are considered. `providerHint: "auto"` or absent → both kinds are considered (OpenAI targets first, then Anthropic, each in slot order).
2. **Collect every target whose globs match `M`.**
3. **Zero matches → `400 provider_selection_error`.** The error lists the configured targets so you can see what globs exist. No upstream call is made.
4. **More than one match → `400 provider_selection_error`.** The relay refuses to guess; the error names the conflicting targets. No upstream call is made. This is the "ambiguous match" guard.
5. **Exactly one match → that target serves the request.**

The important consequence of rule 4: **keep your globs disjoint across targets.** Overlapping globs are a configuration error, surfaced loudly as a 400, rather than silently routing to whichever slot happened to be first.

### Why not "first match wins"?

Routing to the first matching slot would be deterministic by slot order, but overlapping globs would then become a silent footgun: a typo like `OPENAI_MODEL_1="gpt-*"` plus `OPENAI_MODEL_2="gpt-5"` would quietly send every `gpt-5` request to slot 1 with slot 1's key and base URL — possibly the wrong account/upstream — and you'd never get a signal. Rejecting ambiguity turns that into an immediate, clear 400. If you genuinely want a catch-all/shadow target, that is the separate "failover / replicas" feature on the roadmap, not glob routing.

## Bare catch-all `*` is rejected

A bare `*` (matching every model) is rejected at config-parse time with a `ConfigurationError`:

```
OPENAI_MODEL_1 must not use a bare '*' catch-all. It makes the target ambiguous
against every other target (every model matches), so the relay would reject every
request as ambiguous. Use a broad prefix (e.g. 'gpt-*', 'glm-*') or an explicit
comma-separated model list instead.
```

Why: under the reject-ambiguous rule, a bare `*` makes its target match *every* model, so it conflicts with every other target's globs — every request would be ambiguous. The only configuration where `*` "works" is a single-target Worker, which is a trap the moment you add a second target. Broad prefixes (`gpt-*`, `glm-*`) and explicit lists cover the real use cases safely.

## Resolving an intentional overlap

If two targets both legitimately cover a model, you must disambiguate so exactly one matches:

- **Different providers**: send `providerHint` on the request. Note that `providerHint` narrows by *provider kind* (openai vs anthropic), not by slot — two overlapping *same-provider* slots still conflict.
- **Same provider**: make the globs disjoint. Give each target an exclusive set of model globs.

Example of disjoint slots serving the same provider:

```jsonc
"vars": {
  "OPENAI_BASE_1": "https://cheap.example/v1",
  "OPENAI_API_1": "<secret>",
  "OPENAI_MODEL_1": "gpt-4o-mini,glm-4*",

  "OPENAI_BASE_2": "https://premium.example/v1",
  "OPENAI_API_2": "<secret>",
  "OPENAI_MODEL_2": "gpt-5,gpt-4o"
}
```

Here `gpt-5` and `gpt-4o` go to the premium target; everything else OpenAI-shaped goes to the cheap target. No ambiguity.

## Debugging routing

The `/v1/debug/translate` route (when `ENABLE_DEBUG_ROUTES=true`) resolves a target and returns the selected provider, slot, and wire format without calling the upstream — useful for confirming which target a given model will hit. When the live Worker returns `400 provider_selection_error`, read the message: it lists every configured target and its globs, which tells you immediately whether the problem is a no-match (add/broaden a glob) or an overlap (make globs disjoint).

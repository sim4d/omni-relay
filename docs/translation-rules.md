# Translation Rules

## Architectural rule

All translation flows through a canonical intermediate representation (IR):

1. ingress protocol request → IR
2. IR → provider adapter request
3. provider response/events → normalized result/events
4. normalized result/events → caller-facing protocol response

Protocol-to-protocol pair translators are not the primary architecture.

## Tooling rules

- Custom function tools are the only guaranteed cross-provider tool abstraction in MVP.
- Provider-native tool features stay provider-native unless deliberately normalized in a later milestone.
- Tool calls and tool results must be represented explicitly in the IR.

## Error rules

- Invalid requests fail during schema validation.
- Unsupported cross-provider features fail during feature gating.
- Provider selection must happen before upstream calls.

## Streaming rules

- Streaming is modeled in the IR from the start.
- Upstream SSE streams must be processed incrementally.
- Full streaming responses should not be buffered into memory.

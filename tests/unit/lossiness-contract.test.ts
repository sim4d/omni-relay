import { describe, expect, it } from 'vitest'
import { parseOpenAIChatRequest } from '../../src/protocols/openai-chat/parse'
import { parseOpenAIResponsesRequest } from '../../src/protocols/openai-responses/parse'
import { parseAnthropicMessagesRequest } from '../../src/protocols/anthropic-messages/parse'
import { mapNormalizedRequestToOpenAIChatRequest } from '../../src/providers/openai/map-request'
import { mapNormalizedRequestToOpenAIResponsesRequest } from '../../src/providers/openai/map-responses-request'
import { mapNormalizedRequestToAnthropicMessagesRequest } from '../../src/providers/anthropic/map-request'

/**
 * Lossiness contract: every "known" ingress field must be accounted for on the
 * same-provider round-trip. A field is accounted for if, after parse →
 * same-provider map, it reappears (possibly renamed) on the egress payload.
 *
 * This test exists to prevent silent field-drop regressions as the IR grows.
 * When you add a new ingress field, add it to KNOWN_FIELDS and ensure it
 * round-trips on at least its native provider path.
 */

// OpenAI Chat fields the IR must account for (same-provider: chat -> chat).
const OPENAI_CHAT_FIELDS = {
  user: 'user-123',
  seed: 42,
  logprobs: true,
  top_logprobs: 5,
  n: 1,
  frequency_penalty: 0.5,
  presence_penalty: 0.5,
  service_tier: 'priority',
}

// OpenAI Responses fields the IR must account for (same-provider: responses -> responses).
const OPENAI_RESPONSES_FIELDS = {
  previous_response_id: 'resp_prev',
  store: true,
  user: 'user-123',
  service_tier: 'priority',
}

describe('lossiness contract: known fields round-trip on their native path', () => {
  describe('OpenAI Chat -> OpenAI Chat', () => {
    for (const [field, value] of Object.entries(OPENAI_CHAT_FIELDS)) {
      it(`preserves ${field}`, () => {
        const normalized = parseOpenAIChatRequest({
          model: 'glm-4.7',
          messages: [{ role: 'user', content: 'hi' }],
          [field]: value,
        })
        const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
        expect(body[field]).toEqual(value)
      })
    }
  })

  describe('OpenAI Responses -> OpenAI Responses', () => {
    for (const [field, value] of Object.entries(OPENAI_RESPONSES_FIELDS)) {
      it(`preserves ${field}`, () => {
        const normalized = parseOpenAIResponsesRequest({
          model: 'glm-4.7',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
          [field]: value,
        })
        const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as Record<string, unknown>
        expect(body[field]).toEqual(value)
      })
    }
  })

  describe('Anthropic Messages -> Anthropic Messages', () => {
    it('preserves metadata', () => {
      const normalized = parseAnthropicMessagesRequest({
        model: 'glm-4.7',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { user_id: 'user-123' },
      })
      const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
      expect(body.metadata).toEqual({ user_id: 'user-123' })
    })

    it('preserves thinking on the same-provider path', () => {
      const normalized = parseAnthropicMessagesRequest({
        model: 'glm-4.7',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled', budget_tokens: 8000 },
      })
      const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
    })
  })
})

describe('lossiness contract: cross-provider translation does not invent fields', () => {
  it('drops OpenAI-only fields when translating Chat -> Anthropic (no silent invention)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      user: 'user-123',
      seed: 42,
      logprobs: true,
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    // These have no Anthropic equivalent and must NOT appear (invented shapes
    // would be worse than dropping).
    expect(body.user).toBeUndefined()
    expect(body.seed).toBeUndefined()
    expect(body.logprobs).toBeUndefined()
  })
})

describe('lossiness contract: newly-modeled fields survive their native round-trip', () => {
  // Guards the fields added in the cross-vendor fidelity work against future
  // silent regressions. Each must map to a real IR field, not unmappedRequestFields.
  it('preserves top_p on Chat -> Chat', () => {
    const normalized = parseOpenAIChatRequest({ model: 'm', messages: [{ role: 'user', content: 'hi' }], top_p: 0.7 })
    expect(normalized.output?.topP).toBe(0.7)
    expect((mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>).top_p).toBe(0.7)
  })

  it('preserves parallel_tool_calls on Chat -> Chat', () => {
    const normalized = parseOpenAIChatRequest({ model: 'm', messages: [{ role: 'user', content: 'hi' }], parallel_tool_calls: false })
    expect(normalized.parallelToolCalls).toBe(false)
    expect((mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>).parallel_tool_calls).toBe(false)
  })

  it('preserves reasoning_effort -> reasoning_effort on Chat -> Chat', () => {
    const normalized = parseOpenAIChatRequest({ model: 'm', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' })
    expect(normalized.reasoning?.effort).toBe('high')
    expect((mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>).reasoning_effort).toBe('high')
  })

  it('preserves reasoning.effort -> reasoning.effort on Responses -> Responses', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'm',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      reasoning: { effort: 'high' },
    })
    expect(normalized.reasoning?.effort).toBe('high')
    const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as Record<string, unknown>
    expect((body.reasoning as Record<string, unknown>)?.effort).toBe('high')
  })

  it('preserves an image block on Chat -> Chat (multimodal modelled field)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'm',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://e.com/x.png' } }] }],
    })
    expect(normalized.messages[0].content.some((b) => b.type === 'image')).toBe(true)
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as { messages: Array<{ content: Array<Record<string, unknown>> }> }
    expect(body.messages[0].content.some((p) => p.type === 'image_url')).toBe(true)
  })
})


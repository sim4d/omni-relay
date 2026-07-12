import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from '../../src/core/stream-events'
import { parseOpenAIChatRequest } from '../../src/protocols/openai-chat/parse'
import { parseOpenAIResponsesRequest } from '../../src/protocols/openai-responses/parse'
import { parseAnthropicMessagesRequest } from '../../src/protocols/anthropic-messages/parse'
import { mapNormalizedRequestToOpenAIChatRequest } from '../../src/providers/openai/map-request'
import { mapNormalizedRequestToOpenAIResponsesRequest } from '../../src/providers/openai/map-responses-request'
import { mapNormalizedRequestToAnthropicMessagesRequest } from '../../src/providers/anthropic/map-request'
import { mapOpenAIChatStreamToEvents } from '../../src/providers/openai/map-stream'
import { mapOpenAIResponsesStreamToEvents } from '../../src/providers/openai/map-responses-stream'
import { renderOpenAIChatStream } from '../../src/protocols/openai-chat/stream'
import { mapOpenAIResponsesResponseToNormalizedResult } from '../../src/providers/openai/map-responses-response'
import { renderOpenAIResponsesStream } from '../../src/protocols/openai-responses/stream'
import { renderAnthropicMessagesStream } from '../../src/protocols/anthropic-messages/stream'

function chunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoded = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(encoded))
      controller.close()
    },
  })
}

/**
 * Build an SSE stream from typed (event:+data:) frames, for upstreams that key
 * off the `event:` line (OpenAI Responses, Anthropic).
 */
function eventStream(frames: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoded = frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('')
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(encoded))
      controller.close()
    },
  })
}


describe('A1: reasoning_effort <-> thinking normalization', () => {
  it('parses OpenAI Chat reasoning_effort into IR reasoning config', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    })
    expect(normalized.reasoning).toEqual({ effort: 'high', enabled: true })
  })

  it('parses Anthropic thinking into IR reasoning config', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'enabled', budget_tokens: 16000 },
    })
    expect(normalized.reasoning).toEqual({ budgetTokens: 16000, enabled: true, effort: 'high' })
  })

  it('maps IR reasoning to OpenAI reasoning_effort on Chat egress', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'xhigh',
    })
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
    expect(body.reasoning_effort).toBe('xhigh')
  })

  it('maps IR reasoning to Anthropic thinking with budget on Anthropic egress', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 32000 })
  })

  it('maps IR reasoning to OpenAI Responses reasoning object', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'high',
    })
    const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as Record<string, unknown>
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('disables reasoning when reasoning_effort is none', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'none',
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})

describe('A4: Responses id vs call_id split', () => {
  it('preserves distinct id and call_id when both are present', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-4.7',
      input: [
        { role: 'user', content: 'hi' },
        { type: 'function_call', id: 'fc_123', call_id: 'call_456', name: 'foo', arguments: '{}' },
      ],
    })
    const toolCall = normalized.messages[1].content[0]
    expect(toolCall).toMatchObject({ type: 'tool_call', id: 'fc_123', callId: 'call_456', name: 'foo' })
  })

  it('leaves callId undefined when only id is present; egress defaults it to id', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-4.7',
      input: [
        { role: 'user', content: 'hi' },
        { type: 'function_call', id: 'fc_only', name: 'foo', arguments: '{}' },
      ],
    })
    const toolCall = normalized.messages[1].content[0] as { id: string; callId?: string }
    expect(toolCall.id).toBe('fc_only')
    expect(toolCall.callId).toBeUndefined()

    const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as {
      input: Array<{ content: Array<Record<string, unknown>> }>
    }
    const fnCall = body.input[1].content[0]
    // Egress defaults call_id to id when the IR carried no explicit callId.
    expect(fnCall).toMatchObject({ type: 'function_call', id: 'fc_only', call_id: 'fc_only' })
  })

  it('renders both id and call_id on Responses egress', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-4.7',
      input: [
        { role: 'user', content: 'hi' },
        { type: 'function_call', id: 'fc_123', call_id: 'call_456', name: 'foo', arguments: '{}' },
      ],
    })
    const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as {
      input: Array<{ content: Array<Record<string, unknown>> }>
    }
    const fnCall = body.input[1].content[0]
    expect(fnCall).toMatchObject({ type: 'function_call', id: 'fc_123', call_id: 'call_456' })
  })
})

describe('A6: top_p forwarding', () => {
  it('parses top_p from OpenAI Chat', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      top_p: 0.9,
    })
    expect(normalized.output?.topP).toBe(0.9)
  })

  it('parses top_p from Anthropic', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      top_p: 0.9,
    })
    expect(normalized.output?.topP).toBe(0.9)
  })

  it('forwards top_p on Chat egress', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      top_p: 0.5,
    })
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
    expect(body.top_p).toBe(0.5)
  })

  it('forwards top_p on Anthropic egress', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      top_p: 0.5,
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.top_p).toBe(0.5)
  })
})

describe('A3: parallel_tool_calls forwarding', () => {
  it('parses parallel_tool_calls from Chat and forwards it', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      parallel_tool_calls: false,
    })
    expect(normalized.parallelToolCalls).toBe(false)
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
    expect(body.parallel_tool_calls).toBe(false)
  })
})

describe('A5: Anthropic cache_control passthrough', () => {
  it('preserves cache_control on text blocks through Anthropic ingress -> egress', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      system: [{ type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'hi' }],
    })
    const block = normalized.instructions[0]
    expect(block).toMatchObject({ type: 'text', text: 'You are helpful.', cacheControl: { type: 'ephemeral' } })

    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      system: Array<Record<string, unknown>>
    }
    expect(body.system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
  })
})

describe('A2: multimodal image translation', () => {
  it('translates OpenAI image_url data URL to Anthropic image base64 source', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBOR=' } },
        ],
      }],
    })
    const imageBlock = normalized.messages[0].content[1]
    expect(imageBlock).toMatchObject({ type: 'image', mediaType: 'image/png', data: 'iVBOR=' })

    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const anthropicImage = body.messages[0].content.find((b) => b.type === 'image')
    expect(anthropicImage).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBOR=' },
    })
  })

  it('translates Anthropic image block to OpenAI Chat image_url on Chat egress', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
        ],
      }],
    })
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const imagePart = body.messages[0].content.find((p) => p.type === 'image_url')
    expect(imagePart).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    })
  })
})

describe('A2: multimodal document (PDF) translation', () => {
  it('translates OpenAI input_file data URL to Anthropic document base64 source', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-4.7',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'summarize this' },
          { type: 'input_file', file: { file_data: 'data:application/pdf;base64,JVBER' } },
        ],
      }],
    })
    const docBlock = normalized.messages[0].content[1]
    expect(docBlock).toMatchObject({ type: 'document', mediaType: 'application/pdf', data: 'JVBER' })

    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const anthropicDoc = body.messages[0].content.find((b) => b.type === 'document')
    expect(anthropicDoc).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' },
    })
  })

  it('translates Anthropic document block to OpenAI input_file on Responses egress', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBER' } },
        ],
      }],
    })
    const body = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as {
      input: Array<{ content: Array<Record<string, unknown>> }>
    }
    const filePart = body.input[0].content.find((p) => p.type === 'input_file')
    expect(filePart).toMatchObject({
      type: 'input_file',
      media_type: 'application/pdf',
      data: 'JVBER',
    })
  })
})

describe('B5/B6: streaming usage (include_usage) end-to-end', () => {
  it('captures a separate terminal usage chunk after finish_reason (regression)', async () => {
    // OpenAI sends finish_reason first, then a separate usage-only chunk.
    const upstream = chunkStream([
      { id: 'c1', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { id: 'c1', object: 'chat.completion.chunk', model: 'm', choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
    ])

    const events = []
    for await (const event of mapOpenAIChatStreamToEvents(upstream)) {
      events.push(event)
    }

    const usageEvents = events.filter((e) => e.type === 'usage')
    expect(usageEvents).toHaveLength(1)
    expect(usageEvents[0]).toMatchObject({ type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } })
    // response_end must still be emitted (deferred to [DONE]).
    expect(events.at(-1)).toMatchObject({ type: 'response_end', finishReason: 'stop' })
  })

  it('egress emits finish chunk BEFORE the terminal usage chunk (correct order)', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'm' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'hi' } as const
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } } as const
      yield { type: 'response_end', finishReason: 'stop' } as const
    }

    const body = await new Response(renderOpenAIChatStream(events(), true)).text()
    const chunks = body.split('\n\n').filter(Boolean)
    // Find the finish chunk (has finish_reason) and the usage chunk (has usage).
    const finishIdx = chunks.findIndex((c) => c.includes('"finish_reason":"stop"'))
    const usageIdx = chunks.findIndex((c) => c.includes('"usage"'))
    expect(finishIdx).toBeGreaterThanOrEqual(0)
    expect(usageIdx).toBeGreaterThanOrEqual(0)
    expect(usageIdx).toBeGreaterThan(finishIdx) // usage AFTER finish
    expect(chunks.at(-1)).toContain('[DONE]')
  })

  it('egress omits usage chunk when include_usage is false', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'm' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'usage', usage: { inputTokens: 5 } } as const
      yield { type: 'response_end', finishReason: 'stop' } as const
    }
    const body = await new Response(renderOpenAIChatStream(events(), false)).text()
    expect(body).not.toContain('"usage"')
  })
})

describe('A1 edge: thinking budget_tokens <= 0 disables (no upstream 400)', () => {
  it('treats budget_tokens: 0 as disabled', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'enabled', budget_tokens: 0 },
    })
    expect(normalized.reasoning).toEqual({ enabled: false })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})

describe('A2 edge: malformed multimodal parts are skipped, not rejected', () => {
  it('skips an image_url with empty url on Chat ingress (no provider_extension)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: '' } },
      ] }],
    })
    const types = normalized.messages[0].content.map((b) => b.type)
    expect(types).toEqual(['text']) // malformed image dropped, not wrapped
  })

  it('rejects a data: URL with no comma (not forwarded as bogus url)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/png' } },
      ] }],
    })
    // No image block produced (malformed data URL has no payload).
    expect(normalized.messages[0].content).toHaveLength(0)
  })
})

describe('B3 edge: deeply-nested tool_result content is depth-capped', () => {
  it('does not stack-overflow on deep nesting', () => {
    // Build 50 levels of nested tool_result.content.
    let inner: Record<string, unknown> = { type: 'text', text: 'deep' }
    for (let i = 0; i < 50; i++) {
      inner = { type: 'tool_result', tool_use_id: 't', content: [inner] }
    }
    expect(() => parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [inner] }],
    })).not.toThrow()
  })
})

describe('P1: Anthropic stream closes thinking block before opening text block', () => {
  it('emits content_block_stop(thinking) before content_block_start(text)', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'anthropic', model: 'm' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'reasoning_delta', text: 'thinking...' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'answer' } as const
      yield { type: 'response_end', finishReason: 'stop' } as const
    }
    const body = await new Response(renderAnthropicMessagesStream(events())).text()
    const chunks = body.split('\n\n').filter(Boolean)
    // thinking block is index 0; its stop must precede the text block start.
    const thinkingStopIdx = chunks.findIndex(
      (c) => c.includes('"content_block_stop"') && c.includes('"index":0'),
    )
    const textStartIdx = chunks.findIndex(
      (c) => c.includes('"content_block_start"') && c.includes('"type":"text"'),
    )
    expect(thinkingStopIdx).toBeGreaterThanOrEqual(0)
    expect(textStartIdx).toBeGreaterThanOrEqual(0)
    expect(thinkingStopIdx).toBeLessThan(textStartIdx)
  })

  it('emits message_start even when the upstream stream is empty (no content events)', async () => {
    async function* events() {
      yield { type: 'response_end', finishReason: 'stop' } as const
    }
    const body = await new Response(renderAnthropicMessagesStream(events())).text()
    const chunks = body.split('\n\n').filter(Boolean)
    const msgStartIdx = chunks.findIndex((c) => c.includes('"message_start"'))
    const msgDeltaIdx = chunks.findIndex((c) => c.includes('"message_delta"'))
    expect(msgStartIdx).toBeGreaterThanOrEqual(0)
    expect(msgDeltaIdx).toBeGreaterThan(msgStartIdx)
  })
})

describe('P1: adaptive / budgetless thinking does not produce invalid {type:enabled}', () => {
  it('preserves thinking:{type:adaptive} on the Anthropic same-provider path', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'adaptive' },
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  it('omits thinking for an OpenAI auto effort routed to Anthropic (no invalid enabled-without-budget)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-4.7',
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'auto',
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as Record<string, unknown>
    expect(body.thinking).toBeUndefined()
  })
})

describe('P1: Responses id!=call_id keeps tool correlation on single-id egress', () => {
  const responsesInput = [
    { role: 'user', content: 'hi' },
    { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'ls', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'result' },
  ]

  it('uses call_id as the Chat tool_call id so it matches tool_call_id', () => {
    const normalized = parseOpenAIResponsesRequest({ model: 'glm-4.7', input: responsesInput })
    const body = mapNormalizedRequestToOpenAIChatRequest(normalized) as {
      messages: Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>
    }
    const assistant = body.messages.find((m) => m.role === 'assistant' && m.tool_calls)
    const tool = body.messages.find((m) => m.role === 'tool')
    expect(assistant?.tool_calls?.[0].id).toBe('call_1')
    expect(tool?.tool_call_id).toBe('call_1')
  })

  it('uses call_id as the Anthropic tool_use id so it matches tool_use_id', () => {
    const normalized = parseOpenAIResponsesRequest({ model: 'glm-4.7', input: responsesInput })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const blocks = body.messages.flatMap((m) => m.content)
    const toolUse = blocks.find((b) => b.type === 'tool_use') as { id?: string }
    const toolResult = blocks.find((b) => b.type === 'tool_result') as { tool_use_id?: string }
    expect(toolUse.id).toBe('call_1')
    expect(toolResult.tool_use_id).toBe('call_1')
  })
})

describe('B3 edge: tool_result content rendering on Anthropic egress', () => {
  it('uses the flat string when there is no structured content', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-4.7',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'run it' }] },
        { type: 'function_call', name: 'run', arguments: '{}', call_id: 'c1' },
        { type: 'function_call_output', call_id: 'c1', output: 'flat-output' },
      ],
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const tr = body.messages.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: unknown }
    expect(tr.content).toBe('flat-output')
  })

  it('uses structured content (text) when present, preferring its text as the flat value', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: 'rich output' }] }],
      }],
    })
    const body = mapNormalizedRequestToAnthropicMessagesRequest(normalized) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>
    }
    const tr = body.messages.flatMap((m) => m.content).find((b) => b.type === 'tool_result') as { content: unknown }
    expect(Array.isArray(tr.content)).toBe(true)
    expect(tr.content).toEqual([{ type: 'text', text: 'rich output' }])
  })

  it('joins multi-text structured tool_result content with newlines (regression for JSON-stringified array fallback)', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'c1',
          content: [
            { type: 'text', text: 'first line' },
            { type: 'text', text: 'second line' },
          ],
        }],
      }],
    })
    const tr = normalized.messages[0].content[0] as { result: string; content?: unknown }
    // The IR's flat `result` should be the newline-joined text, not a JSON array.
    expect(tr.result).toBe('first line\nsecond line')
  })

  it('keeps the JSON fallback for heterogeneous structured tool_result content', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'c1',
          content: [
            { type: 'text', text: 'caption' },
            // image blocks are not supported inside tool_result on Anthropic
            // today, but the parser still preserves them via provider_extension;
            // what matters here is that we DON'T pretend the result is plain text.
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
          ],
        }],
      }],
    })
    const tr = normalized.messages[0].content[0] as { result: string; content?: unknown }
    // Heterogeneous blocks: flat fallback is still a JSON-encoded array so
    // string-only consumers can at least round-trip the structured form.
    expect(tr.result.startsWith('[')).toBe(true)
  })
})

describe('Responses streaming reasoning_summary_text rendering', () => {
  it('maps upstream reasoning deltas to reasoning_delta events and renders them back', async () => {
    // Upstream OpenAI Responses stream with a reasoning summary, then text.
    const upstream = eventStream([
      { event: 'response.created', data: { type: 'response.created', response: { id: 'r1', model: 'm', object: 'response' } } },
      { event: 'response.reasoning_summary_text.delta', data: { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', delta: 'think' } },
      { event: 'response.reasoning_summary_text.delta', data: { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', delta: 'ing' } },
      { event: 'response.output_text.delta', data: { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'answer' } },
      { event: 'response.completed', data: { type: 'response.completed', response: { id: 'r1', model: 'm', status: 'completed' } } },
    ])

    const events: NormalizedEvent[] = []
    for await (const event of mapOpenAIResponsesStreamToEvents(upstream)) {
      events.push(event)
    }
    // The reasoning deltas collapse into reasoning_delta events.
    const reasoning = events.filter((e): e is Extract<NormalizedEvent, { type: 'reasoning_delta' }> => e.type === 'reasoning_delta')
    expect(reasoning.map((e) => e.text).join('')).toBe('thinking')

    // Re-rendering through the Responses egress must emit reasoning_summary_text.delta frames.
    async function* replay() {
      for (const event of events) {
        if (event.type !== 'response_end') yield event
      }
      yield { type: 'response_end', finishReason: 'stop' } as const
    }
    const body = await new Response(renderOpenAIResponsesStream(replay())).text()
    expect(body).toContain('response.reasoning_summary_text.delta')
    expect(body).toContain('reasoning_summary_text.done')
    expect(body).toContain('"type":"reasoning"')
  })
})

describe('cross-wire unmapped field isolation (Responses -> Chat)', () => {
  // Regression for z.ai code 1210: Codex sends Responses-native fields
  // (store, include, prompt_cache_key, service_tier) that must NOT leak into
  // the Chat Completions upstream body. The relay should only passthrough
  // unmapped fields on the same-wire path (Responses->Responses, Chat->Chat).
  it('drops Responses-native fields when mapping to Chat Completions', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [{ type: 'function', name: 'shell', description: 'run', parameters: { type: 'object', properties: {} } }],
      parallel_tool_calls: true,
      reasoning: { effort: 'high' },
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: 'session-abc',
      service_tier: 'auto',
      max_output_tokens: 1024,
    })
    const chat = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
    expect(chat.store).toBeUndefined()
    expect(chat.include).toBeUndefined()
    expect(chat.prompt_cache_key).toBeUndefined()
    expect(chat.service_tier).toBeUndefined()
    expect(chat.reasoning_effort).toBe('high')
    expect(chat.parallel_tool_calls).toBe(true)
    expect(chat.max_completion_tokens).toBe(1024)
  })

  it('drops Chat-native fields when mapping to Responses', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'hi' }],
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 42,
      user: 'user-123',
      logprobs: true,
    })
    const resp = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as Record<string, unknown>
    expect(resp.frequency_penalty).toBeUndefined()
    expect(resp.presence_penalty).toBeUndefined()
    expect(resp.seed).toBeUndefined()
    expect(resp.user).toBeUndefined()
    expect(resp.logprobs).toBeUndefined()
  })



  it('keeps Chat-native fields on the same-wire Chat -> Chat path (ingressProtocol gate)', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'hi' }],
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 42,
      user: 'user-123',
      logprobs: true,
    })
    const chat = mapNormalizedRequestToOpenAIChatRequest(normalized) as Record<string, unknown>
    // Same-wire passthrough: Chat-native unmapped fields survive because
    // ingressProtocol === 'chat.completions'.
    expect(chat.frequency_penalty).toBe(0.5)
    expect(chat.presence_penalty).toBe(0.3)
    expect(chat.seed).toBe(42)
    expect(chat.user).toBe('user-123')
    expect(chat.logprobs).toBe(true)
  })

  it('keeps Responses-native fields on the same-wire Responses -> Responses path (ingressProtocol gate)', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      store: false,
      prompt_cache_key: 'session-abc',
      service_tier: 'auto',
    })
    const resp = mapNormalizedRequestToOpenAIResponsesRequest(normalized) as Record<string, unknown>
    // Same-wire passthrough: Responses-native unmapped fields survive because
    // ingressProtocol === 'responses'.
    expect(resp.store).toBe(false)
    expect(resp.prompt_cache_key).toBe('session-abc')
    expect(resp.service_tier).toBe('auto')
  })
})

describe('P1: Responses upstream response keeps tool correlation across single-id variants', () => {
  // Regression for map-responses-response.ts: when the upstream item omits
  // id or call_id, we must still preserve the single correlation identifier
  // (so a tool_result referencing call_id matches the tool_call the IR emits).
  // Mirrors the resolveCallIds() contract used by the ingress parser.
  it('mirrors call_id onto id when item omits id (only call_id present)', () => {
    const result = mapOpenAIResponsesResponseToNormalizedResult({
      id: 'resp_1',
      model: 'glm-5.2',
      status: 'completed',
      output: [
        { type: 'function_call', call_id: 'call_only', name: 'shell', arguments: '{}' },
      ],
    })
    const toolCall = result.output[0] as { id: string; callId?: string; name: string }
    expect(toolCall).toMatchObject({ type: 'tool_call', id: 'call_only', callId: 'call_only', name: 'shell' })
  })

  it('preserves id and leaves callId undefined when item omits call_id (only id present)', () => {
    const result = mapOpenAIResponsesResponseToNormalizedResult({
      id: 'resp_2',
      model: 'glm-5.2',
      status: 'completed',
      output: [
        { type: 'function_call', id: 'fc_only', name: 'shell', arguments: '{}' },
      ],
    })
    const toolCall = result.output[0] as { id: string; callId?: string; name: string }
    expect(toolCall).toMatchObject({ type: 'tool_call', id: 'fc_only', name: 'shell' })
    expect(toolCall.callId).toBeUndefined()
  })

  it('preserves both id and call_id when upstream provides both', () => {
    const result = mapOpenAIResponsesResponseToNormalizedResult({
      id: 'resp_3',
      model: 'glm-5.2',
      status: 'completed',
      output: [
        { type: 'function_call', id: 'fc_123', call_id: 'call_456', name: 'shell', arguments: '{}' },
      ],
    })
    const toolCall = result.output[0] as { id: string; callId?: string; name: string }
    expect(toolCall).toMatchObject({ type: 'tool_call', id: 'fc_123', callId: 'call_456', name: 'shell' })
  })
})

describe('P1: reasoning items in Responses input do not produce content:null on Chat wire', () => {
  // Regression for z.ai code 1210: Codex sends reasoning items (with
  // encrypted_content) in the Responses input. These have no Chat Completions
  // equivalent and must not produce user messages with content:null.
  it('skips reasoning items when converting Responses input to Chat', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking...' }], encrypted_content: 'ABC123' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    })
    const chat = mapNormalizedRequestToOpenAIChatRequest(normalized) as { messages: Array<{ role: string; content: string | null }> }
    // The reasoning item must NOT appear as a user message with content:null
    const nullContentMsgs = chat.messages.filter((m) => m.content === null && m.role === 'user')
    expect(nullContentMsgs).toHaveLength(0)
    // The actual user message should survive
    expect(chat.messages.some((m) => m.role === 'user' && m.content === 'hi')).toBe(true)
  })
})

describe('P2: reasoning-only assistant message survives Chat filter (reasoning_content)', () => {
  // Regression for the message filter in map-request.ts: an assistant message
  // that carries only reasoning_content (from Anthropic thinking blocks) and
  // no text content or tool_calls must NOT be dropped by the filter.
  it('keeps reasoning-only assistant messages on the Chat wire', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-4.7',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'let me think...', signature: 'sig123' }] },
        { role: 'user', content: 'follow up' },
      ],
    })
    const chat = mapNormalizedRequestToOpenAIChatRequest(normalized) as {
      messages: Array<{ role: string; content: string | null; reasoning_content?: string }>
    }
    // The reasoning-only assistant message must survive (not filtered out)
    const reasoningMsg = chat.messages.find((m) => m.reasoning_content !== undefined)
    expect(reasoningMsg).toBeDefined()
    expect(reasoningMsg!.reasoning_content).toBe('let me think...')
    // Both user messages must survive too
    expect(chat.messages.filter((m) => m.role === 'user')).toHaveLength(2)
  })
})

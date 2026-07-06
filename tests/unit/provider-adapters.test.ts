import { mapNormalizedRequestToAnthropicMessagesRequest } from '../../src/providers/anthropic/map-request'
import { mapAnthropicMessagesResponseToNormalizedResult } from '../../src/providers/anthropic/map-response'
import { mapNormalizedRequestToOpenAIResponsesRequest } from '../../src/providers/openai/map-responses-request'
import { mapOpenAIResponsesResponseToNormalizedResult } from '../../src/providers/openai/map-responses-response'
import type { NormalizedRequest } from '../../src/core/ir'

describe('provider adapter mapping', () => {
  const normalizedRequest: NormalizedRequest = {
    targetModel: 'glm-5.2',
    providerHint: 'openai',
    instructions: [{ type: 'text', text: 'be concise' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    tools: [{ type: 'function', name: 'lookup_weather', inputSchema: { type: 'object' } }],
    toolChoice: { type: 'tool', name: 'lookup_weather' },
    output: { temperature: 0.2, maxOutputTokens: 128, stop: ['END'] },
    stream: false,
    metadata: { tenant: 'demo' },
  }

  it('maps normalized requests to an OpenAI Responses payload', () => {
    const payload = mapNormalizedRequestToOpenAIResponsesRequest(normalizedRequest)
    expect(payload.model).toBe('glm-5.2')
    expect(payload.instructions).toBe('be concise')
    expect((payload.input[0] as Record<string, unknown>).role).toBe('user')
    expect((payload.tools?.[0] as Record<string, unknown>).type).toBe('function')
    expect(payload.tool_choice).toEqual({ type: 'function', name: 'lookup_weather' })
  })

  it('maps custom OpenAI Responses tools and preserved same-provider fields upstream', () => {
    const payload = mapNormalizedRequestToOpenAIResponsesRequest({
      ...normalizedRequest,
      toolChoice: { type: 'tool', name: 'codex', toolType: 'custom' },
      tools: undefined,
      extensions: {
        openai: {
          ingressProtocol: 'responses',
          customTools: [{ type: 'custom', name: 'codex', description: 'Run commands' }],
          unmappedRequestFields: { reasoning: { effort: 'high' }, parallel_tool_calls: false },
        },
      },
    })
    const payloadRecord = payload as Record<string, unknown>

    expect(payload.tools).toEqual([{ type: 'custom', name: 'codex', description: 'Run commands' }])
    expect(payload.tool_choice).toEqual({ type: 'custom', name: 'codex' })
    expect(payloadRecord.reasoning).toEqual({ effort: 'high' })
    expect(payloadRecord.parallel_tool_calls).toBe(false)
  })

  it('maps OpenAI Responses custom tool calls back to normalized provider-native blocks', () => {
    const result = mapOpenAIResponsesResponseToNormalizedResult({
      id: 'resp_custom_1',
      model: 'glm-5.2',
      status: 'completed',
      output: [
        {
          type: 'custom_tool_call',
          id: 'ctc_1',
          call_id: 'call_1',
          name: 'codex',
          input: 'ls -la',
        },
      ],
    })

    expect(result.finishReason).toBe('tool_calls')
    expect(result.output[0]).toEqual({
      type: 'provider_extension',
      provider: 'openai',
      name: 'custom_tool_call',
      payload: {
        type: 'custom_tool_call',
        id: 'ctc_1',
        call_id: 'call_1',
        name: 'codex',
        input: 'ls -la',
      },
    })
  })

  it('maps normalized requests to an Anthropic Messages payload', () => {
    const payload = mapNormalizedRequestToAnthropicMessagesRequest(normalizedRequest)
    expect(payload.model).toBe('glm-5.2')
    expect(payload.system).toBe('be concise')
    expect(payload.max_tokens).toBe(128)
    expect((payload.tools?.[0] as Record<string, unknown>).name).toBe('lookup_weather')
    expect(payload.tool_choice).toEqual({ type: 'tool', name: 'lookup_weather' })
  })

  it('maps OpenAI Responses output back to normalized results', () => {
    const result = mapOpenAIResponsesResponseToNormalizedResult({
      id: 'resp_1',
      model: 'glm-5.2',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'omni relay ok' }],
        },
      ],
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
    })

    expect(result.provider).toBe('openai')
    expect(result.output[0]).toEqual({ type: 'text', text: 'omni relay ok' })
    expect(result.usage?.totalTokens).toBe(8)
  })

  it('maps Anthropic Messages output back to normalized results', () => {
    const result = mapAnthropicMessagesResponseToNormalizedResult({
      id: 'msg_1',
      model: 'glm-4.7',
      content: [{ type: 'tool_use', id: 'tool_1', name: 'lookup_weather', input: { city: 'Paris' } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 4, output_tokens: 2 },
    })

    expect(result.provider).toBe('anthropic')
    expect(result.finishReason).toBe('tool_calls')
    expect(result.output[0]).toEqual({
      type: 'tool_call',
      id: 'tool_1',
      name: 'lookup_weather',
      argumentsJson: '{"city":"Paris"}',
    })
  })
})

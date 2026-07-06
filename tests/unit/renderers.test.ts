import { renderAnthropicMessagesResponse } from '../../src/protocols/anthropic-messages/render'
import { renderOpenAIChatResponse } from '../../src/protocols/openai-chat/render'
import { renderOpenAIResponsesResponse } from '../../src/protocols/openai-responses/render'
import type { NormalizedResult } from '../../src/core/ir'

describe('protocol renderers', () => {
  const textResult: NormalizedResult = {
    model: 'glm-4.7',
    provider: 'anthropic',
    output: [{ type: 'text', text: 'omni relay ok' }],
    usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    responseId: 'resp_1',
  }

  it('renders OpenAI chat responses', () => {
    const payload = renderOpenAIChatResponse(textResult)
    expect(payload.object).toBe('chat.completion')
    expect(payload.choices[0]?.message.content).toBe('omni relay ok')
    expect(payload.usage?.total_tokens).toBe(6)
  })

  it('renders OpenAI responses payloads', () => {
    const payload = renderOpenAIResponsesResponse(textResult)
    expect(payload.object).toBe('response')
    expect(payload.output_text).toBe('omni relay ok')
    expect((payload.output[0] as Record<string, unknown>).type).toBe('message')
  })

  it('renders OpenAI responses custom tool calls without rewriting them as function calls', () => {
    const payload = renderOpenAIResponsesResponse({
      model: 'glm-5.2',
      provider: 'openai',
      output: [
        {
          type: 'provider_extension',
          provider: 'openai',
          name: 'custom_tool_call',
          payload: {
            type: 'custom_tool_call',
            id: 'ctc_1',
            call_id: 'call_1',
            name: 'codex',
            input: 'ls',
          },
        },
      ],
      responseId: 'resp_custom_1',
    })

    expect((payload.output[0] as Record<string, unknown>).type).toBe('custom_tool_call')
    expect((payload.output[0] as Record<string, unknown>).call_id).toBe('call_1')
  })

  it('renders Anthropic messages payloads with tool use blocks', () => {
    const payload = renderAnthropicMessagesResponse({
      model: 'glm-5.2',
      provider: 'openai',
      output: [
        { type: 'tool_call', id: 'call_1', name: 'lookup_weather', argumentsJson: '{"city":"Paris"}' },
      ],
      responseId: 'msg_1',
    })

    expect(payload.type).toBe('message')
    expect(payload.stop_reason).toBe('tool_use')
    expect((payload.content[0] as Record<string, unknown>).type).toBe('tool_use')
  })
})

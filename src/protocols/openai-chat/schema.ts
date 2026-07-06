import { z } from 'zod'

export const openAIChatContentPartSchema = z.object({
  type: z.string(),
}).passthrough()

export const openAIChatMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([
    z.string(),
    z.array(openAIChatContentPartSchema),
    z.null(),
  ]).optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })).optional(),
}).passthrough()

export const openAIChatToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.unknown().optional(),
    strict: z.boolean().optional(),
  }).passthrough(),
}).passthrough()

export const openAIChatToolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
    }),
  }).passthrough(),
])

export const openAIChatRequestSchema = z.object({
  model: z.string().min(1),
  providerHint: z.enum(['openai', 'anthropic', 'auto']).optional(),
  messages: z.array(openAIChatMessageSchema).min(1),
  tools: z.array(openAIChatToolSchema).optional(),
  tool_choice: openAIChatToolChoiceSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough()

export type OpenAIChatRequest = z.infer<typeof openAIChatRequestSchema>

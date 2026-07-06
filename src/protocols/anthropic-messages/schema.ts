import { z } from 'zod'

export const anthropicContentBlockSchema = z.object({
  type: z.string(),
}).passthrough()

export const anthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string(),
    z.array(anthropicContentBlockSchema),
  ]),
}).passthrough()

export const anthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.unknown(),
}).passthrough()

export const anthropicToolChoiceSchema = z.union([
  z.object({ type: z.enum(['auto', 'any']) }).passthrough(),
  z.object({
    type: z.literal('tool'),
    name: z.string(),
  }).passthrough(),
])

export const anthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(anthropicMessageSchema).min(1),
  system: z.union([
    z.string(),
    z.array(anthropicContentBlockSchema),
  ]).optional(),
  tools: z.array(anthropicToolSchema).optional(),
  tool_choice: anthropicToolChoiceSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  stop_sequences: z.array(z.string()).optional(),
}).passthrough()

export type AnthropicMessagesRequest = z.infer<typeof anthropicMessagesRequestSchema>

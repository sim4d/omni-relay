import { z } from 'zod'

export const openAIResponsesInputItemSchema = z.object({
  type: z.string().optional(),
  role: z.string().optional(),
  content: z.unknown().optional(),
}).passthrough()

export const openAIResponsesToolSchema = z.object({
  type: z.string(),
}).passthrough()

export const openAIResponsesRequestSchema = z.object({
  model: z.string().min(1),
  providerHint: z.enum(['openai', 'anthropic', 'auto']).optional(),
  input: z.union([
    z.string(),
    z.array(openAIResponsesInputItemSchema),
  ]),
  instructions: z.string().optional(),
  tools: z.array(openAIResponsesToolSchema).optional(),
  tool_choice: z.unknown().optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  text: z.unknown().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
}).passthrough()

export type OpenAIResponsesRequest = z.infer<typeof openAIResponsesRequestSchema>

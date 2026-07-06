import { ValidationError } from '../errors'

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch (error) {
    throw new ValidationError('Request body must be valid JSON', {
      cause: error instanceof Error ? error.message : String(error),
    })
  }
}

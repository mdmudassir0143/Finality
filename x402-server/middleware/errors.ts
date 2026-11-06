import { ZodError } from 'zod'
import type { ErrorHandler } from 'hono'
import { FinalityError } from '../../lib/contracts/errors'

export const errorHandler: ErrorHandler = (error, c) => {
  const requestId = c.get('requestId') || crypto.randomUUID()
  if (error instanceof ZodError) return c.json({ success:false, requestId, error:{ code:'invalid_request', message:'Request validation failed', details:error.flatten() } }, 400)
  if (error instanceof FinalityError) return c.json({ success:false, requestId, error:{ code:error.code, message:error.message, retryable:error.retryable, details:error.details } }, error.status as any)
  console.error(JSON.stringify({ level:'error', requestId, message:error.message }))
  return c.json({ success:false, requestId, error:{ code:'internal_error', message:'Internal server error', retryable:false } }, 500)
}

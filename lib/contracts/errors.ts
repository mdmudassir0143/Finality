export class FinalityError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public retryable = false,
    public details?: unknown,
  ) { super(message) }
}

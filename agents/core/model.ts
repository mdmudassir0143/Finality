import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'

/** Default Gemini model when neither the spec, the CLI nor GEMINI_MODEL picks one. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/**
 * Gemini through the Vercel AI SDK. Reads GEMINI_API_KEY (the repo's existing variable) and falls back to the
 * SDK's own GOOGLE_GENERATIVE_AI_API_KEY. Throws a clear error when neither is set.
 */
export function geminiModel(modelId?: string): { model: LanguageModel; modelId: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('No Gemini key: set GEMINI_API_KEY in .env (Google AI Studio → Get API key).')
  }
  const id = modelId?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL
  return { model: createGoogleGenerativeAI({ apiKey })(id), modelId: id }
}

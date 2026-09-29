import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const port = Number(process.env.PORT ?? 3001)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

export const environment = {
  port,
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
  geminiMockMode: process.env.GEMINI_MOCK_MODE?.toLowerCase() !== 'false',
  geminiFallbackMode: process.env.GEMINI_FALLBACK_MODE?.toLowerCase() !== 'false',
  serpApiApiKey: process.env.SERPAPI_API_KEY,
  serpApiMockMode: process.env.SERPAPI_MOCK_MODE?.toLowerCase() !== 'false',
}
import type { SerpApiClient as SerpApiClientContract, SerpApiSearchParameters } from './types.js'

const endpoint = 'https://serpapi.com/search.json'

export class SerpApiClient implements SerpApiClientContract {
  private readonly fetchImplementation: typeof fetch

  constructor(apiKey: string, fetchImplementation: typeof fetch = globalThis.fetch) {
    if (!apiKey.trim()) {
      throw new Error('SERPAPI_API_KEY is required when SERPAPI_MOCK_MODE is false')
    }
    this.apiKey = apiKey
    this.fetchImplementation = fetchImplementation
  }

  private readonly apiKey: string

  async search(parameters: SerpApiSearchParameters): Promise<unknown> {
    const url = new URL(endpoint)
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, String(value))
    }
    url.searchParams.set('api_key', this.apiKey)

    const response = await this.fetchImplementation(url)
    if (!response.ok) {
      throw new Error(`SerpApi request failed with status ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('SerpApi returned an invalid response')
    }

    if ('error' in payload && typeof payload.error === 'string') {
      throw new Error(`SerpApi request failed: ${payload.error}`)
    }

    return payload
  }
}
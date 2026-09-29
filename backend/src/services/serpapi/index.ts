import { ToolRegistry } from '../../agent/ToolRegistry.js'
import { environment } from '../../config/environment.js'
import { createGoogleSearchTool } from './GoogleSearchTool.js'
import { createGoogleMapsPlacesTool } from './GoogleMapsPlacesTool.js'
import { createGoogleFlightsTool } from './GoogleFlightsTool.js'
import { createGoogleHotelsTool } from './GoogleHotelsTool.js'
import { MockSerpApiClient } from './MockSerpApiClient.js'
import { SerpApiClient } from './SerpApiClient.js'
import type { SerpApiClient as SerpApiClientContract } from './types.js'

export interface SerpApiOptions {
  apiKey?: string
  mockMode?: boolean
  fetchImplementation?: typeof fetch
  client?: SerpApiClientContract
}

export function createSerpApiClient(options: SerpApiOptions = {}): SerpApiClientContract {
  const mockMode = options.mockMode ?? environment.serpApiMockMode
  const apiKey = options.apiKey ?? environment.serpApiApiKey

  if (mockMode) return new MockSerpApiClient()
  if (!apiKey?.trim()) {
    throw new Error('SERPAPI_API_KEY is required when SERPAPI_MOCK_MODE is false')
  }
  return new SerpApiClient(apiKey, options.fetchImplementation)
}

export function registerSerpApiTools(
  registry: ToolRegistry,
  options: SerpApiOptions = {},
): void {
  const client = options.client ?? createSerpApiClient(options)
  registry.register(createGoogleSearchTool(client))
  registry.register(createGoogleMapsPlacesTool(client))
  registry.register(createGoogleFlightsTool(client))
  registry.register(createGoogleHotelsTool(client))
}

export { parseGoogleSearchResponse, createGoogleSearchTool } from './GoogleSearchTool.js'
export {
  createGoogleMapsPlacesTool,
  parseGoogleMapsPlacesResponse,
} from './GoogleMapsPlacesTool.js'
export { createGoogleFlightsTool, parseGoogleFlightsResponse } from './GoogleFlightsTool.js'
export { createGoogleHotelsTool, parseGoogleHotelsResponse } from './GoogleHotelsTool.js'
export { MockSerpApiClient } from './MockSerpApiClient.js'
export { SerpApiClient } from './SerpApiClient.js'
export type {
  GoogleSearchInput,
  GoogleSearchOutput,
  GoogleSearchResult,
  GoogleMapsCoordinates,
  GoogleMapsPlaceResult,
  GoogleMapsPlacesInput,
  GoogleMapsPlacesOutput,
  GoogleFlightsInput,
  GoogleFlightsOutput,
  GoogleFlightsTravelClass,
  GoogleFlightResult,
  GoogleHotelsInput,
  GoogleHotelsOutput,
  GoogleHotelPrice,
  GoogleHotelResult,
  SerpApiClient as SerpApiClientContract,
  SerpApiSearchParameters,
} from './types.js'
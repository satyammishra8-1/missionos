export type SerpApiSearchParameters = Readonly<Record<string, string | number>>

export interface SerpApiClient {
  search(parameters: SerpApiSearchParameters): Promise<unknown>
}

export interface GoogleSearchInput {
  query: string
  location?: string
  numResults?: number
}

export interface GoogleSearchResult {
  title: string
  link: string
  snippet: string
  source: string
}

export interface GoogleSearchOutput {
  query: string
  results: readonly GoogleSearchResult[]
}
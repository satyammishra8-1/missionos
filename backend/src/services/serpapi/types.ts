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

export interface GoogleMapsPlacesInput {
  query: string
  location?: string
  radius?: number
  resultLimit?: number
}

export interface GoogleMapsCoordinates {
  latitude: number
  longitude: number
}

export interface GoogleMapsPlaceResult {
  name: string
  address?: string
  rating?: number
  reviewsCount?: number
  coordinates?: GoogleMapsCoordinates
  placeLink?: string
}

export interface GoogleMapsPlacesOutput {
  query: string
  results: readonly GoogleMapsPlaceResult[]
}
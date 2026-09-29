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

export type GoogleFlightsTravelClass = 'economy' | 'premium_economy' | 'business' | 'first'

export interface GoogleFlightsInput {
  departure: string
  destination: string
  departureDate: string
  returnDate?: string
  passengers: number
  travelClass: GoogleFlightsTravelClass
}

export interface GoogleFlightResult {
  airline: string
  flightNumber: string
  departure: string
  arrival: string
  duration: number
  stops: number
  price: number | string
  link: string
}

export interface GoogleFlightsOutput {
  departure: string
  destination: string
  results: readonly GoogleFlightResult[]
}

export interface GoogleHotelsInput {
  destination: string
  checkIn: string
  checkOut: string
  guests: number
  preferences?: readonly string[]
}

export interface GoogleHotelPrice {
  amount?: number
  display?: string
}

export interface GoogleHotelResult {
  name: string
  price?: GoogleHotelPrice
  rating?: number
  reviews?: number
  location?: string
  amenities?: readonly string[]
  link: string
}

export interface GoogleHotelsOutput {
  destination: string
  results: readonly GoogleHotelResult[]
}
const flightRequestPattern = /\b(?:flights?|fly|flying|airfares?|air travel)\b/i
const hotelRequestPattern = /\b(?:hotels?|lodging|accommodation|overnight stay|place to stay|where to stay|book a room)\b/i
const placesRequestPattern = /\b(?:restaurants?|cafes?|coffee shops?|attractions?|activities|sightseeing|things to do|places to visit|nearby food|nearby places|local experiences|museums?|landmarks?|parks?|markets?|beaches?|tours?)\b/i
const tripPlanningPattern = /\b(?:trips?|itineraries|itinerary|vacations?|holidays?|getaways?|travel plans?|city breaks?)\b/i
const cityVisitPattern = /\bcity visits?\b/i
const destinationResearchPattern = /\b(?:destination (?:guide|information|research)|travel (?:research|guide|advice|requirements|advisory)|visa requirements|entry requirements|best time to visit|things to know before (?:traveling|travelling|visiting)|what to know before (?:traveling|travelling|visiting)|weather (?:in|at|for))\b/i

export function isFlightRequest(goal: string): boolean {
  return flightRequestPattern.test(goal)
}

export function isHotelRequest(goal: string): boolean {
  return hotelRequestPattern.test(goal)
}

export function isPlacesRequest(goal: string): boolean {
  return placesRequestPattern.test(goal)
}

export function isTripPlanningRequest(goal: string): boolean {
  return tripPlanningPattern.test(goal)
}

export function isTravelResearchRequest(goal: string): boolean {
  return destinationResearchPattern.test(goal) ||
    /\b(?:research|guide|weather|local customs)\b.{0,50}\b(?:destination|travel|city|country|visit)\b/i.test(goal) ||
    /\b(?:travel|destination|visit|vacation|trip|holiday)\b.{0,50}\b(?:guide|research|weather|requirements|advice)\b/i.test(goal)
}

export function isTravelMission(goal: string): boolean {
  return isFlightRequest(goal) ||
    isHotelRequest(goal) ||
    isPlacesRequest(goal) ||
    isTripPlanningRequest(goal) ||
    cityVisitPattern.test(goal) ||
    isTravelResearchRequest(goal)
}

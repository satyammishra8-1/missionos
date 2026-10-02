# MissionOS

MissionOS is a travel-only AI agent for researching flights, hotels, places to visit, and destination information. Describe a trip in natural language, add optional constraints, and review the returned travel options, itinerary, constraint assessments, and linked evidence in one workspace.

MissionOS helps with travel research and planning; it does not book travel or guarantee availability, prices, or provider results.

## What it does

- Searches and presents flight options with carrier, flight number, schedule, duration, stops, price, and a Google Flights search link when returned by the provider.
- Searches hotel options and displays available price, rating, review, location, amenity, and search-link details.
- Discovers restaurants, attractions, cafes, and other places using Google Maps results.
- Uses web search for destination research when the selected plan requires it, retaining available source links and attribution.
- Combines travel findings into a summary and, when returned by the planner, a day-by-day itinerary.
- Reports constraints as **satisfied**, **violated**, or **unknown**. An unresolved requirement is not represented as a successful match.
- Separates verified findings, assumptions, missing information, and sources in the result view.

Search examples are provided in the interface. For date-dependent flight and hotel searches, include exact dates; MissionOS asks for missing travel details rather than inventing them.

## Architecture and execution

The application has a React/Vite frontend and a TypeScript/Express backend. The frontend submits a travel mission to `POST /api/missions`; provider credentials remain on the backend.

The backend execution path reuses the existing agent and tool architecture:

1. **Extract requirements.** Mission text and optional JSON constraints are converted into a travel goal, requested capabilities, and deterministic constraint inputs.
2. **Plan.** Gemini function calling selects among registered tools using the mission, tool schemas, constraints, prior observations, and replan history.
3. **Execute.** The existing tool executor validates the selected tool input and calls the registered Google Search, Maps/Places, Flights, or Hotels integration.
4. **Evaluate.** The deterministic constraint evaluator assesses the returned observations. The agent may replan when results fail to satisfy a requirement and may stop to request information when key details are missing.
5. **Report.** The API returns the plan history, tool calls, findings, replans, evidence, verified facts, assumptions, missing information, constraints, status, and final summary.

The mission endpoint currently returns its response after execution; it does **not** stream intermediate planning or tool events to the browser. The in-progress UI says so rather than presenting simulated activity. The execution trace is populated from the actual returned plan and tool calls.

### Gemini

Gemini is the mission planner and summarizer. It chooses registered tools and uses their returned observations to decide whether to continue, replan, or complete. The agent's deterministic constraint evaluator remains separate from Gemini's planning. A capability-planner fallback is available when the Gemini planner fails; the returned mission includes a planner warning when that fallback is used. Fallback use does not turn mock provider output into a verified live result.

### SerpApi integrations

The backend registers tools for:

- **Google Flights:** route, departure date, passengers, travel class, optional return date and currency.
- **Google Hotels:** destination, check-in/out dates, guest count, optional preferences and currency.
- **Google Maps Places:** place query, optional location and radius, and result limit.
- **Google Search:** web research query, optional location, and result count.

Returned fields depend on provider results. Links are search or source links; MissionOS does not complete bookings. Provider availability, quotas, supported locations, and result coverage can vary by query.

### Constraints, replanning, and evidence

Constraints can come from the mission text or the optional request object. Supported inputs include budget and currency, trip duration, route, destination/location, dates, passenger count, time, required preferences, and required tool capabilities.

Each evaluated constraint is shown as satisfied, violated, or unknown with its reason. Violations and unresolved requirements can cause another planning attempt; missing required dates or other essential information may instead stop execution and appear in the result. An overall trip budget is not inferred by adding unrelated individual prices: without comparable evidence for the requested total, the assessment remains unknown.

Evidence is collected from tool observations and includes source attribution and URLs when available. Unavailable URLs are omitted; MissionOS does not fabricate source links.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Copy `backend/.env.example` to `backend/.env`. Configure backend provider credentials and live-mode settings as needed (see [Environment variables](#environment-variables)). The frontend's default API URL works with the local Vite proxy; `frontend/.env.example` is available if a different API base URL is needed.

Do not put provider keys in frontend environment variables, source files, or client-visible configuration.

## Run locally

Start the frontend and backend together from the repository root:

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend health endpoint: <http://localhost:3001/api/health>
- Mission endpoint: `POST http://localhost:3001/api/missions`

Vite proxies `/api` requests to the local backend. To start a single service, run `npm run dev --workspace=frontend` or `npm run dev --workspace=backend`.

Example mission request:

```json
{
  "goal": "Find a flight from Bengaluru to Hyderabad on October 10, 2026 for 2 passengers under ₹20,000",
  "constraints": {
    "budget": {
      "max": 20000,
      "currency": "INR"
    }
  }
}
```

## Environment variables

Configure these in `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port; defaults to `3001`. |
| `FRONTEND_ORIGIN` | Allowed frontend origin; defaults to `http://localhost:5173`. |
| `GEMINI_API_KEY` | Backend-only Gemini credential for the model-backed planner. |
| `GEMINI_MODEL` | Gemini model name; defaults to `gemini-3.8-flash`. |
| `GEMINI_MOCK_MODE` | Enables the built-in Gemini mock when set to `true` and no API key is configured. Do not use mock mode to assess live-provider behavior. |
| `GEMINI_FALLBACK_MODE` | Default fallback setting for callers using `createGeminiAgent` without an explicit override. Mission execution applies its own capability-planner fallback strategy. |
| `SERPAPI_API_KEY` | Backend-only SerpApi credential for Search, Maps, Flights, and Hotels. |
| `SERPAPI_MOCK_MODE` | Enables the built-in SerpApi mock when set to `true` and no API key is configured. Do not use mock mode to assess live-provider behavior. |

`VITE_API_BASE_URL` is an optional public frontend setting for the API base URL. It must never contain provider credentials.

Real mission execution requires both provider keys and does not accept mock results as real mission completion. Keep `.env` files private and out of version control.

## Validation

From the repository root:

```bash
npm run lint --workspace=frontend
npm run build --workspace=frontend
npm test --workspace=backend
npm run build --workspace=backend
npm run lint --workspace=backend
```

Backend tests use mock clients or injected responses where appropriate; those tests do not by themselves verify external API availability. The frontend currently has lint and build checks but no dedicated automated test script.

## Release verification

Live checks were performed on 2026-10-02 and are separate from the automated test suite:

- A flight mission using Gemini and SerpApi Google Flights completed with 20 returned flight options for the tested Bengaluru–Hyderabad query.
- A direct Google Maps Places tool retest using SerpApi returned restaurant results for Koramangala after retrying an unsupported location parameter.
- An end-to-end local restaurant mission returned Maps and web-search findings in an earlier run, but did not complete: its budget assessment remained unknown. A later mission attempt was blocked by the Gemini Free Tier daily request limit.
- The tested Goa itinerary request did not call search tools because exact travel dates were missing.
- Google Hotels was not independently verified against the live provider during these checks. The browser result-layout review used a local fixture, not live mission results.

These checks verify only the specific calls and queries listed above. Live provider behavior was not re-tested during the final release review because the Gemini quota limit had been reached.

## Limitations

- Provider responses can be incomplete, unavailable, rate-limited, or change after a search. Displayed prices and availability should be rechecked with the provider before booking.
- MissionOS provides search and planning links, not booking, payment, or reservation services.
- Exact dates are needed for searches that depend on travel dates. The planner should request missing required information instead of guessing.
- Some constraints may remain unknown when the returned evidence cannot support a deterministic assessment, including an aggregate budget based only on individual item prices.
- Intermediate agent events are not streamed; the UI receives the execution trace with the completed API response.
- A successful software build or mocked test does not certify live-provider behavior for every route, destination, date, or query.

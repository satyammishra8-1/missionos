# MissionOS

MissionOS is an open-source AI agent project. This repository contains a React frontend, a modular Express API, and an agent foundation with a Gemini planner and a SerpApi Google Search tool. Database integrations are not included yet.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+

## Setup

From the repository root:

```bash
npm install
```

Copy `backend/.env.example` to `backend/.env`. The frontend can use its defaults, or you can copy `frontend/.env.example` to `frontend/.env` to configure the API base URL.

## Run in development

From the repository root, start both applications:

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend health check: http://localhost:3001/api/health

The Vite development server proxies `/api` requests to the backend. The frontend status page reports whether the API is reachable.

## Build and lint

```bash
npm run build
npm run lint
```

To run either application separately, use `npm run dev --workspace=frontend` or `npm run dev --workspace=backend` from the repository root.

## Environment variables

The Express API reads `PORT` and `FRONTEND_ORIGIN` from `backend/.env`. The frontend's optional `VITE_API_BASE_URL` is a public API URL only; never put secrets or API keys in frontend environment variables.

## Gemini planner

The backend includes a Gemini function-calling planner. The checked-in environment example uses mock mode, so the agent can run without a key. For live Gemini calls, add a Gemini API key to `backend/.env` and set:

```dotenv
GEMINI_API_KEY=your-key
GEMINI_MOCK_MODE=false
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODE=true
```

Keep `GEMINI_API_KEY` in the backend environment only; do not use a `VITE_` variable for it. `GEMINI_FALLBACK_MODE=true` falls back to the capability planner if a Gemini request or response parse fails. Set it to `false` to surface those failures instead.

Register tools with `ToolRegistry`, then create a model-backed agent with `createGeminiAgent(registry)` from `backend/src/services/gemini`. Each registered tool can provide an `inputSchema`; the model's selected function call is validated by that tool and executed only through the existing `ToolExecutor`. Gemini receives the mission, constraints, available tool descriptions and schemas, agent-state snapshot, prior observations, and replan history. The mock client selects a compatible tool and completes after observing its result.

## Mission Execution

Submit a goal and optional JSON constraints to `POST /api/missions`:

```json
{
	"goal": "Plan an accessible weekend trip to Montreal",
	"constraints": { "budget": 1200, "accessible": true }
}
```

The Gemini planner dynamically selects registered search, Maps/Places, Flights, and Hotels tools, then can execute more tools, replan, or complete based on observations. A completed mission requires useful results from every tool capability requested in the goal and satisfied deterministic constraints. The response includes `missionId`, `status`, plan steps, tool calls, replans, findings, source evidence, and a `result` separating `verifiedFacts`, `assumptions`, and `missingInformation`. Each mission is limited to 12 tool iterations, 8 replans, and 60 seconds by default. Missions without both `GEMINI_API_KEY` and `SERPAPI_API_KEY` return a configuration failure; mock results are not accepted as real mission completion.

Constraints are supplied as a JSON object and budget, duration, route, and requested tool capabilities are also extracted from the goal. The deterministic evaluator supports `budget` as a number or `{ "max": number, "currency": "INR", "scope": "total" }`, `date` as an ISO date or date-field object, `durationDays`, `route` with origin/destination, `location`, `time`, `requiredPreferences`, and `requiredTools`. Each is reported as `satisfied`, `violated`, or `unknown`; violations and unknowns block completion and trigger replanning. Missing exact dates are requested rather than invented. A total budget remains unknown unless evidence contains a comparable aggregate trip cost; individual flight and hotel prices are not assumed to be a verified total.

## SerpApi Search Tools

The backend provides a reusable SerpApi client and registered Google Search, Maps/Places, Flights, and Hotels tools. Isolated tool tests can explicitly use a mock client, but production mission execution requires both Gemini and SerpApi API keys and will not complete using mock results. To enable live searches, set the following in `backend/.env`:

```dotenv
SERPAPI_API_KEY=your-key
SERPAPI_MOCK_MODE=false
```

Keep `SERPAPI_API_KEY` in the backend environment only; never use a `VITE_` variable for it. Register the provider with `registerSerpApiTools(registry)` from `backend/src/services/serpapi`.

Google Search accepts a query, optional location, and optional result count. Google Maps Places accepts a query, optional location and radius, and optional result limit. The travel tools accept:

- Google Flights: departure, destination, departure date, optional return date, passengers, and travel class (`economy`, `premium_economy`, `business`, or `first`). Results include airlines, flight numbers, departure/arrival times, duration, stops, price, and a Google Flights link. A return date is included in the round-trip search.
- Google Hotels: destination, check-in/check-out dates, guest count, and optional preference terms. Results include hotel name, available price/rating/review/location/amenities fields, and a hotel search link. Preferences are appended to the destination search query.

The Maps radius is sent as twice the requested distance for Google Maps viewport height, and result limits are applied locally. Tests use mock clients and injected fetch responses, so they do not make live SerpApi requests.

Run backend checks with `npm run build --workspace=backend`, `npm run lint --workspace=backend`, and `npm test --workspace=backend`.
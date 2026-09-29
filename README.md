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

## SerpApi Google Search

The backend provides a reusable SerpApi client and a Google Search tool that registers with the existing `ToolRegistry` and runs through `ToolExecutor`. Mock mode is enabled by default and works without an API key. To enable live searches, set the following in `backend/.env`:

```dotenv
SERPAPI_API_KEY=your-key
SERPAPI_MOCK_MODE=false
```

Keep `SERPAPI_API_KEY` in the backend environment only; never use a `VITE_` variable for it. Register the provider with `registerSerpApiTools(registry)` from `backend/src/services/serpapi`. The Google Search tool accepts `query`, optional `location`, and optional `numResults` (1-100), and returns normalized organic results with `title`, `link`, `snippet`, and source domain. Tests use mocked clients and injected fetch responses, so they do not make live SerpApi requests.

Run backend checks with `npm run build --workspace=backend`, `npm run lint --workspace=backend`, and `npm test --workspace=backend`.
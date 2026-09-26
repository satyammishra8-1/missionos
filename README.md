# MissionOS

MissionOS is an open-source AI agent project. This repository currently contains a React frontend and a modular Express API foundation; agent behavior and external search integrations are not included yet.

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
# Storyworld Deployment Plan

## Recommendation

Use a single Vercel project for the first production pass.

- Deploy the Vite frontend from `C:\projects\GPTStoryworld\storyworld-frontend\storyworld-frontend`
- Include the Vercel API routes from `C:\projects\GPTStoryworld\storyworld-vercel-backend\storyworld-vercel\api`
- Put the static reader at `/reader` using `C:\projects\GPTStoryworld\storyworld_reader.html`
- Back the API with Vercel Postgres using `C:\projects\GPTStoryworld\storyworld-vercel-backend\storyworld-vercel\schema.sql`

This is cleaner than splitting frontend and backend into separate Vercel projects right now because:

- the frontend and API can share one origin
- no CORS layer is needed for browser requests
- the public site can link to a single Storyworld app URL
- Vercel already supports Vite frontend output plus `/api/*` routes in one project

## Suggested URL Shape

- `storyworld.moralitylab.ai/` or `gptstoryworld.moralitylab.ai/`: main frontend
- `storyworld.moralitylab.ai/reader`: standalone reader
- `storyworld.moralitylab.ai/api/storyworlds`: public API

If you want the Morality Lab site to stay mostly static, keep it on its current Vercel project and link out to the Storyworld app subdomain.

## What Exists Already

### Frontend

Path: `C:\projects\GPTStoryworld\storyworld-frontend\storyworld-frontend`

- Vite + React app
- current UI is a prompt-driven generator
- build command is already `npm run build`
- output is static and Vercel-friendly

### Backend

Path: `C:\projects\GPTStoryworld\storyworld-vercel-backend\storyworld-vercel`

- API routes already exist under `api/storyworlds` and `api/stats`
- schema file already exists
- designed for Vercel Postgres

### Reader

Path: `C:\projects\GPTStoryworld\storyworld_reader.html`

- can be exposed as a static reader page immediately
- good candidate for `/reader`

## Important Product Decision

Right now the frontend calls OpenAI directly from the browser and asks the user for their own API key in local storage.

That is acceptable for an internal tool or researcher-facing BYO-key workflow.

It is not the best production posture for a public Morality Lab Storyworld app if you want:

- org-managed billing
- moderation and rate limits
- model upgrades without client changes
- less user friction

For a public launch, add a server-side generate route and move the OpenAI call off the client.

## Recommended First Release

### Phase 1

Ship a combined Vercel deployment with:

- the existing frontend at `/`
- the existing Postgres-backed API at `/api/*`
- the static reader at `/reader`
- the current browser-side generation flow left in place temporarily

This gets you a live Storyworld surface quickly and lets the main site stop linking to broken placeholder pages.

### Phase 2

Add a server-side route such as `/api/generate` that:

- accepts the storyworld config
- calls OpenAI with an org key from Vercel env vars
- optionally stores the generated result in Postgres
- returns the storyworld JSON to the frontend

Once that exists, remove browser-side API key entry from the frontend.

## Minimum Integration Work

1. Create a deployment repo root that contains:
   - `src/`, `index.html`, `package.json`, `vite.config.js`
   - `api/`
   - `schema.sql`
   - `public/reader/index.html`
   - `vercel.json`
2. Copy the backend API route tree into the frontend project root as `api/`.
3. Copy `storyworld_reader.html` into the frontend public assets and expose it as `/reader`.
4. Add a `vercel.json` that keeps Vite output as the main app while preserving `/api/*`.
5. Create a Vercel Postgres database and run `schema.sql`.
6. Deploy to a dedicated Storyworld subdomain.
7. Update Morality Lab site links to the live Storyworld frontend and reader URLs.

## Recommended Vercel Config

Use one Vercel project rooted at the combined app:

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/$1"
    },
    {
      "source": "/reader",
      "destination": "/reader/index.html"
    }
  ]
}
```

## Environment Variables

### Needed now

- Postgres variables supplied by Vercel if the backend is enabled:
  - `POSTGRES_URL`
  - `POSTGRES_PRISMA_URL`
  - `POSTGRES_URL_NON_POOLING`
  - `POSTGRES_USER`
  - `POSTGRES_HOST`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DATABASE`

### Needed in Phase 2

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## Site Changes After Deploy

Once the Storyworld app is live, update the Morality Lab site to:

- point “Storyworld Frontend Concept” to the deployed Storyworld app instead of GitHub
- point “GPTStoryworld Repo” to the repo only where source code is intended
- replace the broken `storyworlds/quantumthot-main.html` placeholder links with the live Storyworld app or reader

## My Recommendation In One Line

Start with one dedicated Storyworld Vercel project on its own subdomain, not a second backend-only deployment, and only split services later if traffic or ownership boundaries make that necessary.

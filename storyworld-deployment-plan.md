# Storyworld Deployment

## Canonical Architecture

The Morality Lab site and Storyworld product deploy as one Vercel project from this repository.

- `/`: static Morality Lab research site
- `/storyworld`: React catalog and profile experience
- `/editor`: hosted Sweepweave Storyworld Editor
- `/storyworld/reader`: Sweepweave reader
- `/api/storyworlds`: public catalog API
- `/api/storyworlds/:id`: full playable world API
- `/api/stats`: catalog statistics
- `/api/generate`: server-side generation

The root `vercel.json` is the only deployment configuration. `npm run build` builds the nested Vite app and assembles the complete site in `dist/`.

## Database

The API uses Postgres when a connection is configured and falls back to the locally hosted Mihna world otherwise. Production needs at least one of:

- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`

Run `storyworld-app/schema.sql` once against a new database. It creates the catalog tables, indexes, analytics view, and the idempotent `source_path` key used by corpus imports.

## Corpus Import

Preview the authored corpus without writing data:

```powershell
node scripts/import-storyworlds.mjs --dry-run --limit=25
```

Import or update all eligible worlds after setting the database environment variables:

```powershell
npm run import:storyworlds
```

The importer reads `../storyworlds`, skips generated, benchmark, run, archive, vendor, dependency, and hidden trees, and upserts by repository-relative source path.

## Deployment Ownership

The production domain is `www.moralitylab.xyz`. Its Vercel project must be accessible to the token used for environment configuration. The current token can access other team projects but not the project owning `moralitylab.xyz`; database variables cannot be added until that project is shared with the token's account or transferred into the accessible team.

GitHub pushes to `main` currently trigger the production build successfully.

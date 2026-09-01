# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Recipe Hub — a mobile app (iOS/Android) for capturing and structuring recipes (Instagram share import, photo capture, AI structuring via the Claude API). See [CONCEPTION.md](CONCEPTION.md) for full product context, architecture decisions, and the phase roadmap (Phase 0 socle → Phase 1 manual CRUD → Phase 2 Instagram import → Phase 3 photo import → Phase 4 social → Phase 5 intelligent).

**Current state: Phase 0 (socle) complete.** Monorepo scaffolded, API responds, mobile app boots and confirms connectivity to the API. No auth, no recipe CRUD, no Instagram import yet — those start at Phase 1.

## Repo structure

npm workspaces monorepo:

```
apps/api/       Fastify + TypeScript + Prisma backend
apps/mobile/    Expo + TypeScript + React Navigation mobile app
```

The two apps share no code today (no `packages/` in use yet) beyond the root `npm install`.

## Commands

Run from the repo root unless noted.

```bash
npm install                       # installs both workspaces
docker compose up -d              # starts postgres (:5432) + minio (:9000/:9001) — required before running the API
npm run dev:api                   # starts the API (tsx watch) on :3000
npm run dev:mobile                # starts Expo (Metro) for the mobile app
```

Prisma (run from `apps/api`, or via the root scripts):

```bash
npx prisma migrate dev --name <name>   # create + apply a migration after editing schema.prisma
npx prisma generate                    # regenerate the Prisma Client (also runs automatically after migrate)
npx prisma studio                      # inspect the DB visually
```

Typecheck (no test suite exists yet in either app):

```bash
cd apps/api && npx tsc --noEmit
cd apps/mobile && npx tsc --noEmit
```

Health check once the API is running:

```bash
curl http://localhost:3000/health      # liveness only
curl http://localhost:3000/health/db   # round-trips through Prisma to confirm DB connectivity
```

## Architecture

**Request flow**: mobile app → HTTP/JSON → Fastify API → Prisma Client → PostgreSQL. Postgres and MinIO run in Docker (`docker-compose.yml`); the API and mobile app run directly on the host (not containerized) for fast reload during dev — there is no Docker image for the API yet, that's a deployment-time concern (`caddy` + prod compose file, not yet created).

**`apps/api`**: `src/server.ts` boots a Fastify instance (`src/app.ts`) on `0.0.0.0` (not just `localhost`, so a physical phone on the LAN can reach it). Routes are registered as Fastify plugins under `src/routes/` (currently just `health.ts`). `src/lib/prisma.ts` exports a single shared `PrismaClient` instance. `@fastify/cors` is registered with `origin: true` — required because Expo's web target and any browser-based testing hit the API cross-origin; native Expo Go/device builds aren't subject to CORS but the plugin is harmless for them.

**Prisma schema** (`apps/api/prisma/schema.prisma`): six models — `User`, `Recipe`, `Ingredient`, `RecipeIngredient` (join table with a free-text `quantity`, e.g. `"200g"`), `Tag`, `RecipeTag` (join table). `Recipe.steps` is a `Json` array of strings rather than a normalized steps table — deliberately minimal, revisit only if step-level metadata is needed. `Recipe.visibility` (`PRIVATE`/`PUBLIC`, default `PRIVATE`) exists now to support Phase 4 social sharing without a later migration. Account model is single-user (mono-utilisateur) — no group/family table.

**`apps/mobile`**: `App.tsx` renders `src/navigation/RootNavigator.tsx` (React Navigation native-stack) with four stub screens (`Auth`, `RecipeList`, `RecipeDetail`, `RecipeEdit`) — placeholder content only until Phase 1. `src/lib/api.ts` wraps `fetch` against `EXPO_PUBLIC_API_URL` (must be the dev machine's LAN IP when testing on a physical device — `localhost` from a phone means the phone itself). `metro.config.js` extends Metro's `watchFolders`/`resolver.nodeModulesPaths` to the monorepo root — required for Metro to resolve npm-workspaces-hoisted dependencies; without it the bundler can't find packages hoisted above `apps/mobile/node_modules`.

**Env files**: each app has its own `.env.example` (`apps/api`, `apps/mobile`) plus a root one for `docker-compose.yml`. Copy to `.env` locally; none of the `.env` files are committed.

# Recipe Hub

Voir [CONCEPTION.md](./CONCEPTION.md) pour le contexte produit et les décisions d'architecture.

Monorepo npm workspaces : `apps/api` (Fastify + TypeScript + Prisma) et `apps/mobile` (Expo + TypeScript).

## Prérequis

- Node.js 20+ LTS
- Docker Desktop (Postgres + MinIO en dev)
- Expo Go (sur un téléphone physique) ou un émulateur Android / simulateur iOS

## Installation

```bash
npm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

Éditer `apps/mobile/.env` : remplacer `EXPO_PUBLIC_API_URL` par l'IP LAN de la machine de dev (voir note ci-dessous).

## Démarrer l'environnement de dev

```bash
docker compose up -d
```

Démarre Postgres (`localhost:5432`) et MinIO (`localhost:9000`, console `localhost:9001`).

## Backend

```bash
cd apps/api
npx prisma migrate dev   # première fois seulement, ou après modif du schéma
cd ../..
npm run dev:api
```

L'API démarre sur `http://localhost:3000`. Vérifier :

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/db
```

## Mobile

```bash
npm run dev:mobile
```

Scanner le QR code avec l'app Expo Go, ou lancer un émulateur (`a` pour Android, `i` pour iOS, `w` pour le web).

**Important — test sur téléphone physique** : `localhost` dans `EXPO_PUBLIC_API_URL` désigne le téléphone lui-même, pas la machine de dev. Il faut utiliser l'IP LAN de la machine (ex. `http://192.168.1.42:3000`), le téléphone et l'ordinateur devant être sur le même réseau Wi-Fi. Un émulateur Android peut nécessiter `10.0.2.2` à la place de `localhost` ; le simulateur iOS partage le réseau de l'hôte donc `localhost` fonctionne directement.

## Structure

```
apps/
  api/      Fastify + TypeScript + Prisma (PostgreSQL)
  mobile/   Expo + TypeScript + React Navigation
```

`apps/mobile/metro.config.js` étend la résolution de modules à la racine du monorepo (nécessaire pour que Metro trouve les dépendances hoistées par npm workspaces).

## Phase actuelle

Phase 0 — Socle : scaffolding, API qui répond, app qui démarre et vérifie sa connectivité à l'API. Pas encore d'auth, pas d'import Instagram (voir roadmap dans [CONCEPTION.md](./CONCEPTION.md)).

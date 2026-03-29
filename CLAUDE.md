# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RoofReporterAI** — A full-stack roofing measurement and CRM platform built on Cloudflare Pages + Workers. Combines Google Solar API data with a custom geodesic measurement engine, AI vision analysis (Gemini + Cloud Run), and a voice receptionist (LiveKit). Deployed at https://www.roofreporterai.com.

## Commands

```bash
# Development (build first, then serve with D1)
npm run build                # Vite build → dist/ (required before dev:sandbox)
npm run dev:sandbox          # Serve dist/ with local D1 at http://0.0.0.0:3000 (preferred)
npm run dev                  # Vite dev server only (no D1, no Workers runtime)

# Build & Deploy
npm run deploy               # Build + deploy to Cloudflare Pages
npm run deploy:prod          # Build + deploy to production project

# Database (local D1)
npm run db:migrate:local     # Apply all pending migrations
npm run db:seed              # Seed from seed.sql
npm run db:reset             # Wipe D1 + migrate + seed (full reset)
npm run db:console:local     # Interactive D1 SQL console

# Tests
npx vitest run               # Run all tests
npx vitest run src/utils/geo-math.test.ts  # Run single test file
```

**Local env vars**: Put secrets in `.dev.vars` (gitignored) for `dev:sandbox`. Same key names as production Cloudflare secrets.

## Architecture

This is a **monolithic Hono app** (`src/index.tsx`) that serves both the REST API and server-side-rendered HTML from a single Cloudflare Workers deployment. No separate frontend framework — all UI is rendered via Hono JSX or returned as HTML strings from route handlers.

### Layer breakdown

| Layer | Location | Purpose |
|-------|----------|---------|
| Router | `src/index.tsx` | Mounts all route modules, CORS middleware, GA4 analytics injection |
| Routes | `src/routes/` | Thin HTTP controllers — parse request, call service, return response |
| Services | `src/services/` | All business logic, API integrations, PDF/HTML generation |
| Repository | `src/repositories/reports.ts` | All D1 SQL queries |
| Templates | `src/templates/` | 3-page HTML report builder + SVG diagram generators |
| Utils | `src/utils/` | Pure geospatial math (unit tested) + Zod validation schemas |
| Types | `src/types.ts` | Single source of truth for all TypeScript types |

### Key services

- **`roof-measurement-engine.ts`** — Core engine: takes user-drawn GPS trace coordinates (eaves, ridges, hips, valleys), computes projected/sloped area, edge lengths, and material take-off. Cross-checks Solar API but never trusts it blindly. Python equivalent at `tools/roof_measurement_engine.py`.
- **`solar-api.ts`** — Google Solar API: fetches `buildingInsights` (footprint, pitch, segments) and `dataLayers` (GeoTIFF DSM tiles). Priority: DataLayers + buildingInsights > buildingInsights only > mock data.
- **`solar-datalayers.ts`** — GeoTIFF processing: parses DSM elevation rasters to extract per-pixel roof heights.
- **`cloud-run-ai.ts`** — Primary AI path: custom Colab-trained model on Cloud Run, with automatic fallback to Gemini.
- **`gemini.ts`** / **`vision-analyzer.ts`** — Gemini 2.0/2.5 integration for AI roof geometry extraction and vision inspection (fallback path).
- **`report-engine.ts`** — Pure functions assembling final `RoofReport` from all data sources.
- **`gcp-auth.ts`** — Service account JWT → Google OAuth2 access tokens (no gcloud CLI needed).
- **`email.ts`** — Gmail OAuth2 refresh token flow; Resend API as fallback.

### Database

Cloudflare D1 (SQLite at the edge). 40+ sequential migrations in `migrations/`. D1 binding name is `DB` (defined in `wrangler.jsonc`, accessed via `c.env.DB`). Key tables: `admin_users`, `master_companies`, `customer_companies`, `orders`, `reports`, `payments`, `customers`, `invoices`, `jobs`, `pipeline` (CRM), plus telephony/agent tables for LiveKit.

CRM records (`customers`, `invoices`, `proposals`, `jobs`, pipeline) are scoped per user via `owner_id`.

### Authentication

Two separate auth systems:
1. **Admin** (`/admin`, `/api/admin/*`) — SHA-256 + UUID salt password hashing, JWT sessions via Web Crypto API. First registered user gets `superadmin` role.
2. **Customer portal** (`/customer`, `/api/customer/*`) — Separate session token flow in `routes/customer-auth.ts`.

Auth middleware pattern: each route module registers a `use('/*', ...)` middleware that calls `validateAdminSession` or `validateAdminOrCustomer`, attaches the user to `c.set('user', ...)`, and whitelists public endpoints (e.g. `/html` suffix for report HTML rendering).

### Key patterns

**D1 queries** — All SQL lives in `src/repositories/reports.ts` as typed functions. Use `.first<T>()` for single rows, `.all<T>()` for lists:
```typescript
db.prepare('SELECT * FROM reports WHERE order_id = ?').bind(orderId).first<ReportRow>()
```

**Error handling** — Each route module has `onError()` catching a custom `ValidationError` (→ 400) and generic errors (→ 500). Throw `ValidationError` for bad input, let it bubble to the handler.

**Validation** — Use `parseBody(schema, data)` from `src/utils/validation.ts` with Zod schemas. It throws `ValidationError` on failure, which the error handler catches automatically.

**Dual-path AI** — `cloud-run-ai.ts` tries the Cloud Run custom model first; on failure falls back to Gemini services. Both paths return the same `VisionFindings` type.

**Analytics injection** — `src/index.tsx` middleware auto-injects GA4 + consent tracking into all HTML responses that are not API or static routes.

### Routes overview

Beyond the standard CRUD routes, notable modules include:
- `rover.ts` — AI customer support chatbot (OpenAI/Genspark)
- `secretary.ts` — LiveKit AI voice agent integration
- `d2d.ts` — Door-to-door sales territory + knock tracking
- `virtual-tryon.ts` — Roof visualization via Replicate inpainting
- `workers-ai.ts` — Cloudflare Workers AI for image classification/condition assessment
- `heygen.ts` — HeyGen AI avatar video generation
- `meta-connect.ts` — Facebook/Instagram API integration

### LiveKit voice agent (Python)

Separate Python service in `livekit-agent/`. Runs as an independent process (not deployed to Cloudflare). Install deps: `pip install -r livekit-agent/requirements.txt`.

### Environment variables

Required (set via `wrangler secret put` or `.dev.vars` locally):
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY`
- `GEMINI_API_KEY`
- `CLOUD_RUN_URL`, `CLOUD_RUN_API_KEY`
- `GCP_SERVICE_ACCOUNT_JSON` (base64-encoded service account JSON)
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
- `STRIPE_SECRET_KEY` / `SQUARE_ACCESS_TOKEN`
- `JWT_SECRET`

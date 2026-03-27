# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RoofReporterAI** — A full-stack roofing measurement and CRM platform built on Cloudflare Pages + Workers. Combines Google Solar API data with a custom geodesic measurement engine, AI vision analysis (Gemini), and a voice receptionist (LiveKit). Deployed at https://www.roofreporterai.com.

## Commands

```bash
# Development
npm run dev:sandbox          # Full local dev with D1 database at http://0.0.0.0:3000 (preferred)
npm run dev                  # Vite dev server only (no D1)

# Build & Deploy
npm run build                # Vite build → dist/
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

## Architecture

This is a **monolithic Hono app** (`src/index.tsx`) that serves both the REST API and server-side-rendered HTML from the same Cloudflare Workers deployment. There is no separate frontend build step — all UI is rendered via Hono JSX or returned as HTML strings from route handlers.

### Layer breakdown

| Layer | Location | Purpose |
|-------|----------|---------|
| Router | `src/index.tsx` | Mounts all route modules, CORS middleware, GA4 injection |
| Routes | `src/routes/` | Thin HTTP controllers — parse request, call service, return response |
| Services | `src/services/` | All business logic, API integrations, PDF/HTML generation |
| Repository | `src/repositories/reports.ts` | All D1 SQL queries |
| Templates | `src/templates/` | 3-page HTML report builder + SVG diagram generators |
| Utils | `src/utils/` | Pure geospatial math (tested) + Zod validation schemas |
| Types | `src/types.ts` | Single source of truth for all TypeScript types |

### Key services

- **`solar-api.ts`** — Google Solar API: fetches `buildingInsights` (footprint, pitch, segments) and `dataLayers` (GeoTIFF DSM tiles)
- **`solar-datalayers.ts`** — GeoTIFF processing: parses DSM elevation rasters to extract per-pixel roof heights
- **`solar-geometry.ts`** — Geospatial math on top of Solar API data
- **`roof-measurement-engine.ts`** — The core engine: takes user-drawn GPS trace coordinates (eaves, ridges, hips, valleys), computes projected/sloped area, edge lengths, and material take-off. Cross-checks against Solar API but never trusts it blindly. Also exists as a standalone Python version at `tools/roof_measurement_engine.py`.
- **`gemini.ts`** — Gemini 2.0/2.5 integration for AI roof vision analysis and geometry extraction
- **`cloud-run-ai.ts`** — Client for the custom Cloud Run AI model endpoint
- **`vision-analyzer.ts`** — Orchestrates Gemini vision calls for roof condition inspection
- **`email.ts`** — Gmail OAuth2 + Resend for report delivery
- **`report-engine.ts`** — Assembles final report data from all sources
- **`gcp-auth.ts`** — Service account JWT → Google OAuth2 access tokens (no gcloud CLI needed)

### Database

Cloudflare D1 (SQLite at the edge). 40+ sequential migrations in `migrations/`. Key tables: `admin_users`, `master_companies`, `customer_companies`, `orders`, `reports`, `payments`, `customers`, `invoices`, `jobs`, `pipeline` (CRM), plus telephony/agent tables for the LiveKit voice feature.

The D1 binding name is `roofing-production` (defined in `wrangler.jsonc`). Access it in handlers via `c.env.DB`.

### Authentication

Two separate auth systems:
1. **Admin users** (`/admin`, `/api/admin/*`) — SHA-256 + UUID salt password hashing, JWT sessions. First registered user gets `superadmin` role.
2. **Customer portal** (`/customer`, `/api/customer/*`) — Separate auth flow in `routes/customer-auth.ts`.

### LiveKit voice agent (Python)

Separate Python service in `livekit-agent/`. Runs as an independent process (not deployed to Cloudflare). Uses LiveKit Agents with OpenAI/Deepgram/Cartesia plugins. Install deps with `pip install -r livekit-agent/requirements.txt`.

### Environment variables

Required in Cloudflare Workers environment (set via `wrangler secret put` or dashboard):
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_SOLAR_API_KEY`
- `GEMINI_API_KEY`
- `CLOUD_RUN_URL`, `CLOUD_RUN_API_KEY`
- `GCP_SERVICE_ACCOUNT_JSON` (base64-encoded)
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
- `STRIPE_SECRET_KEY` / `SQUARE_ACCESS_TOKEN`
- `JWT_SECRET`

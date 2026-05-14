# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Always log a task memory after every prompt

**At the end of every user-prompt execution — without exception — save a `project` memory summarizing the task just completed before sending the final response.** This is how Claude maintains continuous awareness of what's happening in the codebase across sessions.

Workflow (run this as the last step of every turn, even for tiny edits, questions, or one-line fixes):

1. Write a new memory file at `/Users/ethan/.claude/projects/-Users-ethan-Documents-roofreporter-ai-good-copy/memory/project_task_<YYYY_MM_DD>_<short-slug>.md` with frontmatter `type: project`.
2. Body should include, in this order:
   - **What was asked:** one-line restatement of the user's request.
   - **What changed:** files touched (with paths), behavior change, and whether it was deployed/committed.
   - **Why:** the motivation or root cause if relevant.
   - **State now:** what's live vs. uncommitted vs. broken, so the next session picks up cleanly.
3. Add a one-line index entry to `MEMORY.md`: `- [Short title](project_task_<...>.md) — one-line hook`.
4. If the task is a continuation of an existing project memory, **update that memory in place** instead of creating a duplicate — keep one running memory per feature/initiative.
5. Skip only if the user explicitly says "don't save a memory for this" for the current turn.

This rule overrides the general "don't save ephemeral task details" guidance in the memory system — for this project, every task log is wanted.

## Project Overview

**Roof Manager** — A full-stack roofing measurement and CRM platform built on Cloudflare Pages + Workers. Combines Google Solar API data with a custom geodesic measurement engine, AI vision analysis (Gemini), and a voice receptionist (LiveKit). Deployed at https://www.roofmanager.ca.

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

Loop Tracker (super admin Loops module — `/super-admin/loop-tracker`):
- `SCAN_ADMIN_EMAIL` — admin email used by `scan_admin` to mint synthetic 5-min sessions (no password). Required on **both** the Pages project AND the `roofmanager-agent-cron` Worker for cron-fired scans to authenticate.
- `SCAN_CUSTOMER_EMAIL` — customer email used by `scan_customer`. Optional; without it, leave `agent_configs.scan_customer.enabled = 0`.
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` — optional, enables Browser Rendering REST API for console-error capture during scans. Without these, the console_error check logs a single "skipped" warning and the rest of the scan still runs.
- `FUNNEL_MONITOR_TOKEN` — bearer token for the Claude `/funnel-monitor`, `/gmail-health`, `/signup-health`, `/signup-journey`, AND `/ads-health` slash commands. Single shared secret across all five.
- `REPORTS_MONITOR_TOKEN` — bearer token for the Claude `/reports-monitor` slash command.
- `CLOUD_ROUTINE_TOKEN` — optional bearer token for Anthropic `/schedule` cloud routines POSTing `/api/super-admin/loop-tracker/api/routines/heartbeat`. Falls back to `FUNNEL_MONITOR_TOKEN` when unset.

Ads-health loop (`/ads-health`, fires every 4h via cron + on-demand via slash):
- Checks 10 sections: secret_inventory, gads_label_completeness, pixel_presence_html, ga4_mp_health, meta_capi_health, capi_event_volume, gclid_capture_rate, utm_capture_rate, attribution_table_freshness, conversion_event_drift.
- Emails christinegourley04@gmail.com on warn/fail only (silent on pass).
- Surfaces in `/super-admin/loop-tracker` as a dedicated "Ads + Analytics Health" panel with verdict dot, per-section status, and Run-now button.
- Optional Pages secrets the loop checks for: `META_CAPI_ACCESS_TOKEN` (server CAPI), `META_APP_ID`/`META_APP_SECRET`/`META_AD_ACCOUNT_ID` (Meta connect), `GADS_LEAD_LABEL`/`GADS_CONTACT_LABEL`/`GADS_DEMO_LABEL`/`GADS_PURCHASE_LABEL` (Google Ads conversion labels — the part after `AW-XXX/`). When unset, the loop warns instead of breaking.

Two separate deployments to remember: the Pages project (`roofing-measurement-tool`, all HTTP routes) and the `roofmanager-agent-cron` Worker (`wrangler-cron.jsonc`, fires every 10 min, drives all loops + agents). Cloudflare Pages does NOT honor `scheduled()` handlers — anything cron-driven must live in `src/cron-worker.ts`. Each deployment maintains its own secret store.

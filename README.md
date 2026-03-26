# RoofReporterAI — Professional Roof Measurement & Sales Platform

## Project Overview
- **Name**: RoofReporterAI
- **Version**: 11.0 (Smart Invoice System, E-Signatures, Progress Billing, Report Accuracy Fixes)
- **Domain**: www.roofreporterai.com
- **Production**: https://roofing-measurement-tool.pages.dev
- **GitHub**: https://github.com/ethan8585g/roofreporter-ai-good-copy
- **Platform**: Cloudflare Pages + Workers + D1
- **Status**: Active
- **Last Updated**: 2026-03-25 (v11.0)
- **Codebase**: 56,728 lines TypeScript/JS across 63 source files, 36 routes, 19 services, 36 DB tables

---

## Core Platform Features

### 1. Roof Measurement Reports
- Google Solar API (DataLayers + buildingInsights hybrid)
- GeoTIFF DSM processing for precise slope/pitch
- Professional multi-page HTML reports (RoofScope/EagleView style)
- Satellite imagery, edge breakdown, material BOM
- AI-enhanced reports via Gemini 2.5 Flash
- Fixed: Correct roof plane count display, footprint vs true area columns

### 2. Smart Invoice System (NEW v11.0)
- **One-Click Auto-Generation**: `POST /api/invoices/from-report/:orderId/auto-invoice`
  - Parses report data (sqft, pitch, waste factor) into billable line items
  - Dynamic pricing with steep-roof premium (25% extra for 8:12+ pitch)
  - Automated disposal & recycling fee calculations based on tear-off volume
  - Dumpster count auto-calculated from roof area (1 per 3,000 sqft)
- **Progress Billing**: 30% deposit -> progress payments -> final balance
  - `POST /api/invoices/:id/billing-schedule` to attach schedule
  - `PATCH /api/invoices/:id/billing-schedule/:milestoneId/paid` to mark paid
- **Change Order Management**: Append modifications to original invoice
  - `POST /api/invoices/:id/change-orders` to create
  - `PATCH /api/invoices/:id/change-orders/:coId/approve` to approve (updates invoice total)
- **Interactive Digital Invoices**: `/invoice/view/:token`
  - Secure public web link (no login required)
  - Client can view all line items grouped by category (materials/labor/disposal)
  - Download the original measurement report
  - View billing schedule and change orders
  - Pay via Square checkout
- **E-Signatures**: Canvas signature pad for invoice approval
  - `/api/invoices/public/:token/sign` captures signature, IP, user agent
  - Signed status displayed on invoice with timestamp
- **Gmail Integration**: Send branded invoices via roofer's connected Gmail OAuth

### 3. 3-Tier Good/Better/Best Proposals
- **Good** — 25yr 3-Tab Shingles ($110/sq shingles, $160/sq labor)
- **Better** — 30yr Architectural ($145/sq, $180/sq labor) *Most Popular*
- **Best** — 50yr Luxury/Designer ($225/sq, $210/sq labor)
- Side-by-side comparison page at `/proposal/compare/:groupId`
- Customer signature pad, accept/decline, Square payment links

### 4. Secretary AI (Voice Agent)
- LiveKit + Twilio SIP integration for inbound call handling
- AI agent answers calls with configurable greeting/script
- Webhook-based call logging (messages, appointments, callbacks)
- Super Admin dashboard with call analytics and revenue tracking

### 5. CRM & Business Tools
- Customer management, invoice tracking, job management
- Sales pipeline with lead stages
- Door-to-door (D2D) canvassing module
- Email outreach campaigns
- Calendar integration

### 6. Gemini AI Command Center
- Platform analytics via natural language queries
- OpenAI fallback when Gemini is blocked/rate-limited
- Quick actions: Platform Summary, Strategy, Marketing, Call Analytics

### 7. Additional Features
- Roof Visualizer (merged Virtual Try-On + Home Designer)
- AI Vision Inspection (multimodal damage analysis)
- Blog system (SEO lead funnels)
- Stripe + Square payment processing
- Google Analytics 4 server-side tracking

---

## API Endpoints Summary

### Invoice System (Admin Auth Required)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invoices` | List all invoices with stats |
| GET | `/api/invoices/:id` | Get invoice with items |
| POST | `/api/invoices` | Create manual invoice |
| POST | `/api/invoices/from-report/:orderId/auto-invoice` | **One-click auto-generate from report** |
| PATCH | `/api/invoices/:id/status` | Update invoice status |
| POST | `/api/invoices/:id/send` | Mark as sent |
| POST | `/api/invoices/:id/send-gmail` | Send via Gmail OAuth |
| POST | `/api/invoices/:id/payment-link` | Generate Square payment link |
| POST | `/api/invoices/:id/generate-link` | Generate public shareable link |
| POST | `/api/invoices/:id/billing-schedule` | Attach progress billing |
| PATCH | `/api/invoices/:id/billing-schedule/:mid/paid` | Mark milestone paid |
| POST | `/api/invoices/:id/change-orders` | Create change order |
| PATCH | `/api/invoices/:id/change-orders/:coId/approve` | Approve change order |
| GET | `/api/invoices/:id/change-orders` | List change orders |
| GET | `/api/invoices/:id/billing-schedule` | Get billing schedule |
| DELETE | `/api/invoices/:id` | Delete draft invoice |

### Invoice System (Public - No Auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/invoice/view/:token` | Interactive digital invoice page |
| POST | `/api/invoices/public/:token/sign` | E-signature submission |
| GET | `/invoice/pay/:id` | Legacy payment page |

### Pricing Engine
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/invoices/pricing/presets` | Get cost presets (default + custom) |
| PUT | `/api/invoices/pricing/presets` | Save custom presets |
| POST | `/api/invoices/pricing/calculate` | Calculate proposal from measurements |
| POST | `/api/invoices/pricing/from-report/:orderId` | Calculate from report data |

---

## Data Architecture

### Database: Cloudflare D1 (SQLite)
- **36 tables** covering: orders, reports, customers, invoices, CRM, secretary, analytics, blog, sales, call-center, calendar, D2D, email outreach
- **New tables (v11.0)**: `invoice_billing_schedule`, `invoice_change_orders`, `invoice_change_order_items`, `invoice_signatures`, `invoice_access_tokens`

### Storage Services
- **D1**: All relational data (customers, orders, reports, invoices, CRM)
- **Workers AI**: AI image generation and analysis
- **External**: Google Solar API, Gemini, LiveKit, Twilio, Square, Stripe, Gmail OAuth

---

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Active
- **Tech Stack**: Hono + TypeScript + TailwindCSS (CDN) + D1
- **Build**: `npm run build` (Vite + esbuild, ~300ms)
- **Deploy**: `npx wrangler pages deploy dist --project-name roofing-measurement-tool`
- **Last Deployed**: 2026-03-25

---

## v11.0 Changelog (2026-03-25)
1. **Smart Invoice Auto-Generation**: One-click from roof report to billable invoice
2. **Dynamic Pricing Matrices**: Steep-roof premium (25% for 8:12+), recycling fees, dumpster auto-calc
3. **Progress Billing**: 30% deposit, milestone payments, auto-mark invoice paid when all complete
4. **Change Order Management**: Append modifications, approve to update invoice totals
5. **Interactive Digital Invoices**: Public web links with grouped line items, download report, pay online
6. **E-Signatures**: Canvas signature pad with IP/timestamp tracking
7. **Report Accuracy Fixes**: Correct plane count display, footprint vs true area columns in facet table
8. **Secretary AI Call Duration Fix**: Backfill zero-duration logs, auto-estimate on ensureCallLog
9. **Gemini Command Center Fix**: OpenAI fallback when Gemini API is blocked
10. **AI Site Manager Removed**: Merged into Gemini Command Center
11. **Live Dashboard Fix**: Corrected saFetch header merging to prevent logout
12. **UI Cleanup**: Removed blue "Generating Report" cards, merged Virtual Try-On + Home Designer

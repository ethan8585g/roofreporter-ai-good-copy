# RoofReporterAI — Professional Roof Measurement & Sales Platform

## Project Overview
- **Name**: RoofReporterAI
- **Version**: 12.0 (Cold Call Centre, Mobile Responsive, Apple-Compliant Legal Pages)
- **Domain**: www.roofreporterai.com
- **Production**: https://roofing-measurement-tool.pages.dev
- **GitHub**: https://github.com/ethan8585g/roofreporter-ai-good-copy
- **Platform**: Cloudflare Pages + Workers + D1
- **Status**: Active
- **Last Updated**: 2026-03-27 (v12.0)
- **Codebase**: ~58,000 lines TypeScript/JS across 65+ source files, 40 routes, 20 services, 47+ DB tables

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
- LiveKit room event webhooks — logs ALL calls including <2s no-answer
- Twilio status callback webhooks — captures calls that end before LiveKit
- Super Admin dashboard with call analytics and revenue tracking

### 5. Cold Call Centre (Super Admin) — NEW v12.0
- **AI Outbound Dialer**: Configure agents with phone (+1-240-212-2251) for outbound cold calls
- **7-Tab Interface**: Agents | SIP Mapping | Campaigns | Lead Lists | Call Logs | Live Transcripts | Analytics
- **Agent Management**: Create/edit AI agents with persona, operating hours, max calls/day, timezone
- **Lead List Upload**: CSV file upload or paste — auto-imports company_name, contact_name, phone, email, city, state, job_title
- **Call Logs**: Full call history table with status badges, outcome tracking, transcript preview
- **Live Transcripts**: Real-time call monitoring with auto-refresh, expandable transcript cards
- **Transcript Capture**: Every outbound call captures a full live transcript via Deepgram STT
- **Campaign Scheduling**: Operating days/hours, max concurrent calls, DNC list management
- **Analytics**: Call disposition breakdown, cost tracking, daily trends

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
- **47+ tables** covering: orders, reports, customers, invoices, CRM, secretary, analytics, blog, sales, call-center, calendar, D2D, email outreach, cold-call centre
- **New tables (v12.0)**: `cc_agents`, `cc_agent_personas`, `cc_phone_config`, `cc_campaigns`, `cc_prospects`, `cc_call_logs`, `sip_trunks`, `sales_scripts`, `membership_tiers`, `cc_transcript_flags`, `secretary_room_participants`, `contact_form_submissions`

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
- **Last Deployed**: 2026-03-27

---

## v12.0 Changelog (2026-03-27)
1. **Cold Call Centre (Super Admin)**: Full AI outbound dialer — agents, campaigns, lead lists, transcripts
2. **Agent Setup**: Phone +1-240-212-2251 pre-configured for outbound, LiveKit SIP
3. **Lead List Upload**: CSV file upload + paste with auto-import into campaigns
4. **Live Transcript Monitor**: Real-time outbound call transcripts with auto-refresh
5. **Call Log History**: Full call logs with status, outcome, duration, transcript detail view
6. **Call Logging Fix**: LiveKit room-event and Twilio status webhooks capture ALL calls (even <2s no-answer)
7. **Password Column Fix**: Onboarding uses `password_hash` matching customers table schema
8. **Enrollment Form**: Square checkout replaced with "Contact Us for Enrolment" form for non-onboarded users
9. **Mobile Responsive**: Full cell phone support — dashboard, CRM, secretary, all pages
10. **Apple-Compliant Legal**: Terms of Service and Privacy Policy meeting App Store requirements
11. **11 New DB Tables**: Full cold-call infrastructure added to init-db schema

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

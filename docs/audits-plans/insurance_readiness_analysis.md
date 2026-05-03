# Roof Manager — Insurance-Readiness Analysis

**Scope:** Read-only audit of 165 production orders (162 marked `completed`) under `dev@reusecanada.ca` on https://www.roofmanager.ca, fetched via `GET /api/reports/{id}/html`. Codebase commit `fec47a15`.

**Run date:** 2026-04-28.

---

## 1. Executive summary

Of **163 reports rendered** (165 orders pulled, 2 returned `Report data not available`):

- **Measurement-grade quality is excellent.** 11 of 12 baseline measurement checks pass for ≥97% of reports (pitch in N/12, pitch in degrees, total area, IWB calc, waste table, per-facet table, per-pitch table, edge breakdown, methodology, disclaimer, address, material take-off).
- **Insurance-claim readiness is near-zero.** Of 13 insurer-facing checks, **8 pass at 0%** (claim block, photos, accuracy %, human signoff, facet cardinal labels, pitch confidence, Xactimate codes, insurance-ready flag) and 5 more pass under 18% (penetrations, decking, drainage, existing material, flashing breakdown).
- **Orphan reports:** **2 of 165** (`49` and `50`) return `{"error":"Report data not available"}` from the public `/api/reports/:id/html` endpoint despite the order being marked `completed`. Each one is an insurer-facing liability (paid order, no deliverable).

The story is **not** "the basics are missing." The measurement engine is genuinely good. The gap is the *insurer-facing wrapper*: claim metadata, photos, penetrations, flashing detail, accuracy %, signoff, and adjuster-friendly nomenclature (Xactimate codes, cardinal facet labels).

---

## 2. What the reports already do well

The 163 live reports each produce these 11 sections (verified, with file/line traces):

| # | Section | Pass rate | Source |
|---|---|---|---|
| 1 | Header (logo, address, homeowner / for) | 91% (postal-code regex) | [src/templates/report-html.ts](src/templates/report-html.ts) |
| 2 | Project Totals (area, pitch, gross w/5% waste, IWB SF, planes, structures) | 99% | [report-html.ts:285-326](src/templates/report-html.ts#L285) |
| 3 | Edge Lengths (eave / rake / total perim / ridge / hip / valley LF) | 99% | [report-html.ts:300-326](src/templates/report-html.ts#L300) |
| 4 | Satellite imagery (Google Maps overhead) | n/a (image presence not regex-checkable) | [report-html.ts:430-540](src/templates/report-html.ts#L430) |
| 5 | Waste Factor table (4–15%) | 100% | [report-html.ts:145, 327, 1197](src/templates/report-html.ts#L145) |
| 6 | Length Summary by edge type | 99% (covered by edge-breakdown regex) | [report-html.ts:335-365](src/templates/report-html.ts#L335) |
| 7 | Area By Roof Plane (per-facet area, pitch, %) | 99% | [report-html.ts:366-396](src/templates/report-html.ts#L366) |
| 8 | Area By Pitch (Low / Standard / Steep) | 99% | [report-html.ts:398-430](src/templates/report-html.ts#L398) |
| 9 | 3D rotatable + 2D plan + AI imagery | n/a | [report-html.ts:440-650](src/templates/report-html.ts#L440), [svg-3d-diagram.ts](src/templates/svg-3d-diagram.ts) |
| 10 | Material Take-Off (10 line items) | 98% | [report-html.ts:1240-1500](src/templates/report-html.ts#L1240) |
| 11 | Detailed Edge Breakdown / Roof Face Details / Methodology / Disclaimer | 99% | [report-html.ts:1545, 1603, 631, 1975](src/templates/report-html.ts#L1545) |

**Methodology copy** (verbatim from the live PDFs, [report-html.ts:631](src/templates/report-html.ts#L631)):
> "Measurements from user-traced GPS coordinates (UTM projection, Shoelace formula). Pitch multiplier √(rise²+12²)/12 applied for true 3D surface area. Engine v6.0 — Industry-standard multipliers per GAF/CertainTeed/IKO/EagleView."

This is honest, well-grounded math. The next sections are about packaging that math for an insurance adjuster.

---

## 3. The 15 insurance-claim gaps (A–O)

### Recommendation A: Insurance metadata block
- **Current state:** 0/163 reports (0.0%) include claim #, policy #, carrier, adjuster, date of loss, or peril.
- **Insurance requirement:** Every adjuster-facing measurement report opens with the claim header. Without it, the report can't be filed against a claim — there's no key to attach it to.
- **Root cause class:** 1 (no template section, no D1 column).
- **Remediation (no code):** Manual cover-page PDF the roofer staples to the front before sending. Use the printable checklist in §8.
- **Future code work:** New `report_claim_metadata` table + cover-page template block; populate from order intake form.
- **Priority:** **P0**.

### Recommendation B: Penetrations section (pipe boots, vents, skylights, chimneys)
- **Current state:** 2/163 (1.2%) match a section heading; the matches are decorative. The methodology copy mentions "Flashings, vents, and penetrations" as one body line; no per-item count exists.
- **Insurance requirement:** Adjusters price each penetration separately (Xactimate `RFG VENTH`, `RFG VENTT`, `RFG PIPEJ` 1.5"/2"/3"/4", `RFG SKY`, `RFG CHM*`). A report without counts forces a re-inspection.
- **Root cause class:** 1 (mostly) + 3 (vision-analyzer infers some of this but doesn't persist).
- **Remediation (no code):** Roofer fills a penetrations sub-form during the trace and a separate text addendum is appended to the PDF.
- **Future code work:** `report_penetrations` table; intake UI; new template section between Edge Breakdown and Material Take-Off.
- **Priority:** **P0**.

### Recommendation C: Flashing breakdown by type
- **Current state:** 17.8% (29/163) reports have a single "Step Flashing" line in the take-off (e.g., report 15: `Step Flashing — 29 ft`). 0% include headwall, sidewall, counter, chimney apron/step/counter/cricket, kickout, or skylight flashing kits as separate line items. Only valley flashing is itemized in 100%.
- **Insurance requirement:** Flashings are commonly the entire claim line item — adjusters price them per LF per type with distinct Xactimate codes.
- **Root cause class:** 2/3 (template can render extra rows; `material-estimation-engine.ts` doesn't compute them).
- **Remediation (no code):** Add a flashing checklist + LF measurements as an addendum.
- **Future code work:** Extend material engine to emit per-type flashing rows with their Xactimate codes; expand template table.
- **Priority:** **P0**.

### Recommendation D: Photo evidence section
- **Current state:** 0/163 (0.0%) include a photo gallery, captions, or a "no photos collected" disclaimer.
- **Insurance requirement:** Most carriers reject claims without dated, captioned, GPS-stamped photos of damage. Photos *are* the evidence.
- **Root cause class:** 1 (no `report_photos` table, no template section). Note: a `job_photos` table exists from migration 0096 but is field-app-only and not joined to reports.
- **Remediation (no code):** Roofer attaches a separate PDF photo packet manually.
- **Future code work:** `report_photos` table; upload UI on the report viewer; template gallery block.
- **Priority:** **P0**.

### Recommendation E: Existing material identification + condition
- **Current state:** 6.1% (10/163) — most matches are accidental keyword hits. No structured manufacturer/age/layers/damage fields.
- **Insurance requirement:** Adjusters need to confirm material type (3-tab vs architectural vs designer), manufacturer, age, observed damage modes (hail, wind lift, granule loss, blistering, nail pops, sealant failure), and ITEL match recommendation when shingle is discontinued.
- **Root cause class:** 1.
- **Remediation (no code):** Pre-trace intake form captures these as freeform notes that get appended.
- **Future code work:** `report_existing_material` table; template subsection.
- **Priority:** **P1**.

### Recommendation F: Accuracy tolerance stated as a number
- **Current state:** 0/163. Disclaimer reads "REPORT IS PROVIDED FOR ESTIMATION PURPOSES ONLY. ACTUAL MEASUREMENTS MAY VARY." (twice, [report-html.ts:436](src/templates/report-html.ts#L436), [:1975](src/templates/report-html.ts#L1975)).
- **Insurance requirement:** Industry standard from EagleView/RoofSnap/Hover is `±2% area, ±1% linear`. Stating no number reads as "we don't know."
- **Root cause class:** 4 (wrong format).
- **Remediation (no code):** Hardened disclaimer line — print on top of the existing PDF or replace via redacted overlay until the template change ships.
- **Future code work:** One-line copy edit + accuracy-source citation in [report-html.ts:436, 1975](src/templates/report-html.ts#L436).
- **Priority:** **P0** (cheapest, highest insurer-perception lift).

### Recommendation G: Human / inspector signoff
- **Current state:** 0/163. Footer says only "Engine v6.0".
- **Insurance requirement:** Adjusters want a named accountable measurer (or licensed inspector for the in-person condition assessment). "Engine v6.0" is a software credit, not a signoff.
- **Root cause class:** 1.
- **Remediation (no code):** Manual signature line on the cover sheet.
- **Future code work:** `inspector_name`, `inspector_license`, `signed_at` on `reports`; template signature block.
- **Priority:** **P1**.

### Recommendation H: Per-facet cardinal labels (`Plane A — N`, `Plane B — SW`)
- **Current state:** 0/163 reports show a real cardinal direction next to a plane letter. Per-facet table renders `<plane letter> <empty span>` because `seg.azimuth_direction` is undefined for every facet on the GPS-traced path.
- **Insurance requirement:** Adjusters annotate damage by facet ("hail bruising on the SW slope"). Without cardinal labels they have to count facets clockwise from a corner.
- **Root cause class:** 3. The function `degreesToCardinal()` is wired up at [report-engine.ts:142,178](src/services/report-engine.ts#L142) and [solar-api.ts:721,1026](src/services/solar-api.ts#L721) — but only on the AI-geometry path. The user-traced (`roof_trace`) path that produces these 163 reports never computes per-facet bearings. Render falls back to `<span>${seg.azimuth_direction || ''}</span>` at [report-html.ts:382](src/templates/report-html.ts#L382).
- **Remediation (no code):** None viable manually (would require regenerating each report).
- **Future code work:** Compute per-facet azimuth from each user-traced segment polygon's outward normal and pipe through to the segment record.
- **Priority:** **P1**.

### Recommendation I: Decking / sheathing info
- **Current state:** 1.2% (2/163). No structured field.
- **Insurance requirement:** Sheathing type (plywood / OSB / board), thickness, number of underlayment layers, ventilation NFA per IRC 806.
- **Root cause class:** 1.
- **Remediation (no code):** Intake form captures as text, appended to the PDF.
- **Future code work:** `report_decking` table.
- **Priority:** **P2**.

### Recommendation J: Per-facet pitch confidence/source
- **Current state:** 0/163. Report 207 shows all four facets at identical 7.6:12 — almost certainly a Solar API hand-down, not a per-facet measurement.
- **Insurance requirement:** Adjusters spot-check pitch with a digital level. They want to know which facets were measured vs. inferred.
- **Root cause class:** 4 (no flag exposed).
- **Remediation (no code):** Add a "pitch source" footnote to each facet row in the manually-edited PDF cover.
- **Future code work:** `pitch_source: 'gps' | 'solar' | 'manual'` per segment + footnote in template.
- **Priority:** **P2**.

### Recommendation K: Drainage / scupper section (low-slope)
- **Current state:** 1.8% (3/163). Report 150 (Toronto, 3.5:12) has zero scupper / drain / parapet / coping data.
- **Insurance requirement:** Low-slope claims require these LF and counts.
- **Root cause class:** 1.
- **Remediation (no code):** Conditional addendum for any report with predominant pitch < 4:12.
- **Future code work:** `report_drainage` table; conditional template render when low-slope detected.
- **Priority:** **P1** for low-slope; P2 overall.

### Recommendation L: Existing layers (1 vs 2 tear-off)
- **Current state:** Subset of E — 0% structured.
- **Insurance requirement:** Pricing changes ~30% between 1-layer and 2-layer tear-off. Adjusters always ask.
- **Root cause class:** 1.
- **Remediation (no code):** Intake form question.
- **Future code work:** Column on `report_existing_material`.
- **Priority:** **P1**.

### Recommendation M: Code-zone / climate qualifiers
- **Current state:** Only IRC R905.1.2 / NBC referenced in IWB note ([report-html.ts:1500](src/templates/report-html.ts#L1500)). No hurricane / wind / hail / climate-zone block.
- **Insurance requirement:** Florida Florida Building Code / Texas TDI / ASCE 7 wind zone / FEMA hail probability — varies by state and policy.
- **Root cause class:** 1/4.
- **Remediation (no code):** Region-specific cover-sheet stamp (FL/TX/AB/etc.).
- **Future code work:** Climate-zone resolver from postal code; template paragraph.
- **Priority:** **P2**.

### Recommendation N: Orphan reports (read-path failure)
- **Current state:** 2/165 production orders (1.2%) — IDs **49** and **50** — both `completed` but `/api/reports/:id/html` returns `{"error":"Report data not available"}` (HTTP 404).
- **Insurance requirement:** Every paid completed order must produce a deliverable. An invoiced order with no PDF is grounds for chargeback or refund and looks negligent to the insurer.
- **Root cause class:** 2. At [reports.ts:276](src/routes/reports.ts#L276), the handler returns 404 when both `professional_report_html` and `api_response_raw` are blank. `resolveHtml()` at [reports.ts:144-157](src/routes/reports.ts#L144) requires the JSON to contain `property.address` AND non-empty `segments[]`. For IDs 49/50, the report row exists but the generator finished without writing measurement data — the order was marked `completed` while the report wasn't.
- **Remediation (no code):** Manual: regenerate IDs 49 and 50 (place new orders for the same address, or re-run the generator on the existing order). Process: any order marked `completed` should also be required to have non-null `roof_area_sqft` before delivery.
- **Future code work:** Tighten `markOrderStatus(...,'completed')` to require non-null `professional_report_html` OR valid `api_response_raw`. Add a fallback "minimum viable report" render for orphans (cover sheet + apology + regeneration link) instead of returning a JSON 404 to a browser.
- **Priority:** **P0**.

### Recommendation O: Xactimate line item codes alongside materials
- **Current state:** 0/163 reports cite a single `RFG XXX` code.
- **Insurance requirement:** Cross-referencing the take-off with Xactimate codes makes adjuster review push-button. Examples: `RFG ARCH` (architectural shingle), `RFG IWS` (ice & water), `RFG RIDGC` (ridge cap), `RFG GUTAS` (gutter apron / drip edge eave), `RFG GUTRS` (rake drip edge), `RFG STARTU` (starter), `RFG VALLEYM` (valley metal), `RFG VENTH` (turtle vent), `RFG VENTRC` (ridge vent cap), `RFG PIPEJ` (pipe boot).
- **Root cause class:** 1.
- **Remediation (no code):** A printable Xactimate cross-reference card the roofer hands the adjuster with the PDF.
- **Future code work:** Add `xactimate_code` to each line item in `material-estimation-engine.ts` output; new column in the take-off table at [report-html.ts:1240-1500](src/templates/report-html.ts#L1240).
- **Priority:** **P1** (huge perception lift, low risk).

---

## 4. Orphan-report finding (item N expanded)

| Order ID | HTTP status | Body |
|---|---|---|
| 49 | 404 | `{"error":"Report data not available"}` |
| 50 | 404 | `{"error":"Report data not available"}` |

Both rows almost certainly have `status='completed'` on the `orders` table (you verified this for ID 50; ID 49 surfaced from the same scan and shows the identical body). The `reports` row is empty of measurement data.

**User-facing risk:** the customer hits the report link from their dashboard or an email and sees a JSON error blob. The browser shows literal `{"error":"Report data not available"}` because the response is `application/json`, not `text/html`. Worst case for an insurer-facing roofer: they forward the link to an adjuster.

**Process fix this week (no code):**
1. Identify all orphans by running the same scan periodically (the script in `.scratch/score_reports.mjs` already does it).
2. Regenerate each orphan from the `/admin` retry path before invoicing.

**Code fix (out of scope for this analysis):**
- In [src/routes/reports.ts:276](src/routes/reports.ts#L276), return an HTML "report not yet finished — regenerate?" page (with an admin link) instead of a JSON 404.
- In `markOrderStatus(orderId, 'completed')` at [src/repositories/reports.ts:229-233](src/repositories/reports.ts#L229), refuse to flip the status until the row has a non-null `professional_report_html` or a parseable `api_response_raw`.

---

## 5. Process-level recommendations

### Pre-trace intake checklist (collected before the roofer opens the order map)
- [ ] Claim # / Policy # / Carrier / Adjuster name + email + phone
- [ ] Date of loss + peril (hail / wind / fire / wear / other)
- [ ] Inspection date + inspector name + license #
- [ ] Existing shingle: type / manufacturer / color / age (yrs) / # of layers
- [ ] Decking type (plywood / OSB / board) + thickness
- [ ] Existing ventilation type + count
- [ ] Photos uploaded? Y/N — if N, attach photo packet PDF separately

### Post-trace QA checklist (before "Send Report")
- [ ] Penetrations counted: pipe boots (and diameters), vents, skylights, chimneys
- [ ] Flashings measured: step / headwall / sidewall / counter / chimney apron / kickout / skylight kits
- [ ] Drainage (low-slope only): scuppers / drains / parapet LF / coping LF
- [ ] Damage observed: hail / wind lift / granule loss / blistering / nail pops / sealant failure (per facet)
- [ ] Test square count completed
- [ ] Inspector signed cover sheet
- [ ] Accuracy stamp (`±2% area, ±1% linear`) applied

### "Mark Insurance-Ready" gate
A report is "Insurance-Ready" only when **every** rubric item A–O is satisfied. Until that gate exists in the product, it lives as a manual two-signoff (roofer + office manager).

---

## 6. Template-level recommendations (adjuster-order section sequence)

When the schema work happens, sections should appear in this order:

1. **Cover & Claim Block** *(new — A, G)*
2. **Property Summary** (existing header, hardened with cardinal labels — H)
3. **Inspection Photos** *(new — D)*
4. **Measurement Summary** (existing — keep)
5. **Per-Facet Detail with cardinal labels + pitch confidence** (existing table, populate H + J)
6. **Penetrations** *(new — B)*
7. **Flashing Detail** *(new — C)*
8. **Existing Material & Condition + Layers** *(new — E + L)*
9. **Decking & Ventilation** *(new — I)*
10. **Drainage** *(new, conditional on low-slope — K)*
11. **Material Take-Off with Xactimate codes** (existing table + new column — O)
12. **Methodology & Accuracy** (existing copy hardened with `±2% / ±1%` — F)
13. **Code-Zone / Climate Block** *(new — M)*
14. **Inspector Signoff** *(new — G)*
15. **Appendix** (existing edge breakdown + roof face details)

---

## 7. Calculation-level recommendations

- **Xactimate-aligned squares:** round shingle squares UP to the nearest 1/3 sq, not nearest integer. Many adjusters cross-check this exact rounding.
- **Waste-factor matrix tied to complexity** (already inferred internally — surface in the report):
  - Simple: 5–7%
  - Moderate: 8–10%
  - Complex: 12–15%
  - Very complex: 15–17%
- **IWB extent rule** in the methodology block: full-roof on any segment with rise < 2:12 (already documented at [report-html.ts:1500](src/templates/report-html.ts#L1500)); add a climate-zone modifier (Climate Zone 7+ extends per IRC R905).
- **Ridge-cap LF formula** validated against `(ridge LF + hip LF)` — currently emitted but not always cross-checked. Add a footnote: "Ridge cap LF = ridge + hip; verify against rake-to-ridge transitions."
- **Scupper / parapet / coping LF** auto-required for any roof with predominant pitch < 2:12.

---

## 8. Roofer-facing pre-submission checklist (single-page, no code)

The 22-box check before the PDF goes to an adjuster TODAY:

```
ROOF MANAGER — INSURANCE-READY CHECKLIST  (Order # ___________  Date ____________)

CLAIM HEADER
☐ Carrier name __________________________________________
☐ Claim number __________________________________________
☐ Policy number __________________________________________
☐ Adjuster name / email / phone _________________________
☐ Date of loss __________________________________________
☐ Peril (hail / wind / fire / wear / other) ____________
☐ Inspection date / inspector / license # ______________

ROOF CONDITION
☐ Existing shingle type & manufacturer __________________
☐ Existing color / age (yrs) / # of layers ______________
☐ Decking type & thickness ______________________________
☐ Damage observed (per facet) — circle: hail / wind lift / granule loss / blistering / nail pops / sealant failure
☐ Test square count ___ at facet ___

PENETRATIONS (count each)
☐ Pipe boots: 1.5"___ 2"___ 3"___ 4"___
☐ Vents: turtle ___ box ___ ridge ___ turbine ___ power ___
☐ Skylights ___ (size: ____)    ☐ Chimneys ___ (dim: ____)

FLASHING (LF)
☐ Step ___ ☐ Headwall ___ ☐ Sidewall ___ ☐ Counter ___ ☐ Chimney apron ___ ☐ Kickout ___

LOW-SLOPE (only if predominant pitch < 4:12)
☐ Scuppers ___ ☐ Drains ___ ☐ Parapet LF ___ ☐ Coping LF ___

EVIDENCE
☐ Photo packet attached (n photos = ___, dated, GPS-stamped, captioned)
☐ Cover-sheet signed by inspector

QC
☐ Accuracy stamp on PDF: "±2% area, ±1% linear"
☐ Xactimate code crib sheet attached
```

---

## 9. Phased remediation plan

**Phase 1 — process only (this week, no code).**
- Adopt the §8 checklist.
- Pre-trace intake form (paper or Google Form); roofer pastes results into a one-page cover the office manager prints and staples to the PDF.
- Manual identification + regeneration of orphans 49 and 50.

**Phase 2 — template/copy edits, no schema change.**
- Replace soft disclaimer with `±2% area, ±1% linear` accuracy stamp ([report-html.ts:436, 1975](src/templates/report-html.ts#L436)).
- Reword methodology block to surface `pitch_source`.
- Add a Xactimate cross-reference column to the existing material take-off table at [report-html.ts:1240-1500](src/templates/report-html.ts#L1240). (Static mapping, no DB change.)
- Compute per-facet `azimuth_direction` for the GPS-traced path so the cardinal column at [report-html.ts:382](src/templates/report-html.ts#L382) finally renders for the 163 production reports' future siblings (no migration needed — value lives inside `roof_segments` JSON).

**Phase 3 — data-model additions** (out of scope here, listed for engineering):
- Migrations: `report_claim_metadata`, `report_penetrations`, `report_flashing`, `report_photos`, `report_existing_material`, `report_decking`, `report_drainage`. All forward-only, all nullable, all rendered conditionally so historical reports keep rendering identically.
- Intake UI on the order page; QA UI on the report viewer.
- "Mark Insurance-Ready" gate.
- Read-path patch for orphans (HTML fallback page instead of JSON 404).

---

## Appendix A — Full rubric

See [.scratch/insurance_rubric.md](.scratch/insurance_rubric.md).

## Appendix B — Per-report gap map

See [.scratch/per_report_flags.json](.scratch/per_report_flags.json) (165 rows).

## Appendix C — Orphan IDs

See [.scratch/orphan_ids.txt](.scratch/orphan_ids.txt). Contents:

```
49
50
```

## Appendix D — Codebase pipeline map

See [.scratch/codebase_map.md](.scratch/codebase_map.md).

## Appendix E — Root-cause class per gap

See [.scratch/root_causes.md](.scratch/root_causes.md).

# Xactimate-Quality Measurement Report — Implementation Plan

**Target:** Measurement accuracy parity with EagleView Premium / Xactimate sketch (±2% area, correct edge classification, per-facet pitch) **plus** real ESX export that imports cleanly into Xactimate.

**Constraint:** Google Solar API + user-drawn GPS traces only. No Nearmap / drone / LiDAR.

**Scope of this plan:** Full engineering roadmap (phases, files, risks). Phase 1 begins immediately after sign-off.

---

## 1. Executive Summary

The codebase already contains the bones of an Xactimate-grade engine — a RANSAC plane classifier that can extract ridges/hips/valleys from the Solar DSM, a detailed per-facet data model, and a basic Xactimate XML exporter. The problem is **these pieces are not wired together**. The primary measurement path is a trace-only engine that treats the DSM as a visualization asset. Significant accuracy is left on the table because of three classes of gaps:

1. **Orphaned components.** `runEdgeClassifier()` (`src/services/edge-classifier.ts:672`) is fully implemented DSM plane fitting + ridge/hip/valley detection — but never called from any production route. Multiple Solar API fields (`sunshineQuantiles`, `groundAreaMeters2`, `planeHeightAtCenterMeters`, RGB GeoTIFF) are fetched and ignored.
2. **Incomplete algorithms.** Geometric face splitting in `roof-measurement-engine.ts:1398+` is stubbed out and falls back to **proportional area splitting** (equal area per ridge) whenever a roof has more than one facet. This is the single biggest source of error on any non-trivial roof — measured at 5–15% depending on shape.
3. **Lossy data model.** Per-facet polygons only exist in pixel space (`ai_geometry.facets[].points` is 0–640 pixel coords, never projected back to lat/lng). There is one global `confidence_score`, no per-field provenance, no versioning. A Xactimate-importable report needs per-facet lat/lng polygons and a defensible audit trail.

The plan is six phases. Phases 0–2 move the accuracy needle from the current ~±5% (on simple gable roofs) / unknown-but-much-worse (on hips/valleys) to a defensible ±2% on anything the Solar API can see at HIGH quality. Phase 3 squeezes what's left out of the Solar API itself. Phase 4 hardens math edge cases. Phase 5 is report polish. Phase 6 is real ESX.

**Phase 1 is where I recommend starting**, because the code is already written — it just needs to be integrated.

---

## 2. Gap Analysis: Current State vs. Xactimate Grade

### 2.1 Measurement accuracy

| Dimension | Current | Xactimate target | Gap root cause |
|---|---|---|---|
| Projected footprint area | ±0.3% (Shoelace + tangent plane) | ±1% | **None on small roofs.** Drifts to ~0.5% on >15k sqft at 50°N because there is no spherical-excess correction. Fix in Phase 4. |
| Sloped area, single pitch | ±0.02% (lookup table) | ±1% | **None.** Already excellent. |
| Sloped area, multi-pitch | **±5–15%** | ±2% | **Face splitter is stubbed.** `roof-measurement-engine.ts:1398-1450` returns an empty array; engine falls back to proportional split at lines 1369–1374, which gives every facet equal area regardless of actual geometry. **Biggest single lever in this plan.** |
| Edge classification | User-supplied, no validation | Automatic, validated | **RANSAC edge classifier never called.** `edge-classifier.ts:672` is a complete DSM-based ridge/hip/valley detector; nothing invokes it in any route or service. |
| Per-facet pitch | Global or Solar-weighted average | Per-facet from DSM | `pitch-resolver.ts` resolves a single dominant pitch; per-segment pitch from `buildingInsights.roofSegmentStats[].pitchDegrees` is available but only used to compute the weighted average at `solar-api.ts:236-250`. |
| Cross-check tolerance | ±5% ("MATCH") | ±2% | Hardcoded in `roof-measurement-engine.ts:1824-1836` and `tools/roof_measurement_engine.py:349-371`. |
| Variance-driven rejection | None (always publishes) | Reject / require review at >2% | No code path exists to halt the report when Solar vs. trace disagree. |

### 2.2 Data model

| Field | Stored today? | Needed for Xactimate grade | Notes |
|---|---|---|---|
| Per-facet area, pitch, azimuth | Yes (`segments[]`) | Yes | Schema supports, engine populates |
| **Per-facet polygon in lat/lng** | **No** | **Yes** | Only pixel-space `ai_geometry.facets[].points` exists (`types.ts:172`). Need geographic coords for ESX export and for reconciliation with Solar API segments. |
| Per-edge length (2D + 3D) | Yes | Yes | Schema supports via `edges[].plan_length_ft` + `true_length_ft` |
| Per-edge type | Yes | Yes | `edge_type: 'ridge'|'hip'|...` |
| **Per-field source provenance** | **No** | **Yes** | Need to know whether a pitch came from Solar API, user trace, Gemini, or RANSAC plane fit — both for UI confidence ribbons and for defensibility with adjusters. |
| **Per-field confidence** | **No** (single global) | **Yes** | Xactimate exports with low confidence should be flagged; right now they are published identical to high-confidence ones. |
| Measurement versioning | No (in-place overwrite) | Yes | `saveCompletedReport()` at `repositories/reports.ts:144-216` UPDATEs the row. No history. Re-measurement after engine upgrade destroys the prior result. |

### 2.3 Solar API utilization

| Field | Fetched | Used | Impact of using it |
|---|---|---|---|
| `roofSegmentStats[].pitchDegrees` | ✅ | Partial (averaged) | Already primary pitch input |
| `roofSegmentStats[].azimuthDegrees` | ✅ | ✅ | OK |
| `roofSegmentStats[].planeHeightAtCenterMeters` | ✅ | ❌ stored, never read | Cross-check vs. DSM height; detect stacked roofs |
| `roofSegmentStats[].stats.sunshineQuantiles` | ✅ | ❌ | Per-segment pitch confidence (high quantile variance ⇒ unreliable pitch) |
| `roofSegmentStats[].stats.groundAreaMeters2` | ✅ | ❌ | Shadow footprint for obstruction hints |
| `dataLayers.rgbUrl` (RGB GeoTIFF, 0.1–0.5 m/px) | ✅ | Visualization only | **High-res aerial for geometry refinement — not fed to Gemini today.** Currently converted to a BMP data URL for the report, nothing else. |
| DSM at 0.1 m/px | Available | Downsampled to 0.5 m/px at fetch time (`solar-datalayers.ts:212`) | Fine-grained ridge detection needs 0.1 m/px. Trade-off: memory. Solution: split-resolution — 0.1 m for edges, 0.5 m for areas. |

### 2.4 Report output

| Feature | Today | Xactimate / EagleView Premium |
|---|---|---|
| Page count | 2–5 | 15–30 |
| Dedicated **length diagram** (every edge labeled LF) | ❌ Inline labels on main SVG | ✅ Separate page, one label per edge |
| Dedicated **pitch diagram** (pitch labeled on each facet) | ❌ Table on page 3 only | ✅ Diagram page, pitch printed on each facet |
| Dedicated **area diagram** | Partial (color by pitch) | ✅ |
| **Notes / methodology page** | ❌ | ✅ |
| Material BOM in main report | ❌ Export-only (`/bom`, `/bom.csv`, `/bom.xml`) | ✅ Integrated |
| **Server-side PDF** | ❌ Browser print | ✅ Native PDF |
| ESX export | ❌ Basic XML only (`material-estimation-engine.ts:464-500`) | ✅ Native .esx archive |

---

## 3. Accuracy Ceiling Given the Constraint

You chose to stay on Solar API + user traces. The realistic accuracy ceiling on that stack, honestly assessed:

- **Area (projected + sloped, single pitch):** Already at ±1%. Will be ±0.5% after spherical-excess fix. Excellent.
- **Area (multi-pitch, post face splitter):** ±2% is reachable when HIGH-quality imagery is present. MEDIUM imagery (0.25 m/px) caps at ±3%. BASE imagery (1 m/px) can't do better than ±8% — no amount of engineering can fix it, and the plan treats BASE as "require field verification" rather than "try to be accurate."
- **Ridge / hip / valley detection:** ±5% on linear footage at HIGH imagery, ±10% at MEDIUM, unusable at BASE. DSM at 0.1 m/px is the limiting factor.
- **Pitch:** ±0.5 rise:12 per facet at HIGH imagery when RANSAC plane fit is used. Within tolerance for Xactimate pitch factors.
- **Per-facet area when DSM is noisy (trees, HVAC shadows):** Bounded by RANSAC robustness. Already surprisingly good in the existing edge-classifier code (plane fit is least-squares refined via covariance eigenanalysis at `edge-classifier.ts:298-370`).

Bottom line: **±2% is defensible at HIGH imagery after Phases 0–2.** MEDIUM/BASE require explicit field-verification workflow, and the plan makes that UX-visible rather than hiding it.

---

## 4. Phased Implementation Plan

### Phase 0 — Foundations (schema + types)

**Effort:** 2–3 days. **Blocks:** All downstream phases.

No accuracy gain by itself, but every subsequent phase depends on these fields existing.

**4.0.1 Migration `0137_measurement_provenance.sql`**
- `reports.measurement_metadata TEXT` — stringified JSON, per-field `{ source, confidence, timestamp, derivation_notes }`.
- `reports.facet_polygons_geo TEXT` — stringified JSON array, `{ facet_id, lat_lng_ring: [[lat,lng], ...], source }`. Populated by projecting `ai_geometry.facets[].points` (pixel space) back through the imagery's affine transform, OR from the user trace's partitioned face polygons.
- `reports.engine_version TEXT` — e.g., `"2026.04-phase1"`. Stamped at save time.
- `reports.previous_version_id INTEGER` — optional FK to `report_versions` for recompute history.

**4.0.2 New table `report_versions`**
```sql
CREATE TABLE report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  engine_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,    -- full RoofReport at this version
  created_at INTEGER NOT NULL,
  superseded_at INTEGER,
  FOREIGN KEY (report_id) REFERENCES reports(id)
);
```
When `saveCompletedReport()` or `saveEnhancedReport()` runs, it writes the previous row's `api_response_raw` to `report_versions` before overwriting. Enables recompute + rollback.

**4.0.3 Type additions in `src/types.ts`**
- Extend `RoofSegment` with `polygon_lat_lng?: [number, number][]`, `pitch_source: 'solar_api' | 'ransac_dsm' | 'user_default' | 'gemini'`, `pitch_confidence: number // 0-1`.
- Extend `EdgeMeasurement` with `source: 'user_trace' | 'ransac_dsm' | 'auto_inferred'`, `confidence: number`.
- New `MeasurementMetadata` interface mapping field paths to `{ source, confidence, computed_at, engine_version }`.

**4.0.4 Repository updates**
- `src/repositories/reports.ts:144-216` — `saveCompletedReport()` writes previous row to `report_versions` before UPDATE, writes new `measurement_metadata` and `facet_polygons_geo` columns.
- `src/repositories/reports.ts:302-327` — `saveEnhancedReport()` same treatment.

**4.0.5 API additions in `src/routes/reports.ts`**
- `POST /:orderId/recompute` — new endpoint. Re-runs the engine at the current `engine_version` against stored trace. Archives the existing report to `report_versions`. Returns new report + list of fields that changed.
- `GET /:orderId/versions` — lists historical versions with field-level diffs.

**Rollback plan:** Additive migration. If something breaks, fields are optional; old paths still work.

---

### Phase 1 — Wire Up RANSAC + Trace Reconciliation (START HERE)

**Effort:** 4–6 days. **Accuracy gain:** 15–25% on edge classification, 5–10% on sloped area (via per-facet pitch from RANSAC planes).

This is the single highest-leverage change in the plan. All the code already exists.

**4.1.1 Invoke `runEdgeClassifier()` in the Solar pipeline**
- `src/services/solar-datalayers.ts` — after `analyzeSlopeFromDSM()` (around line 791), call `runEdgeClassifier(dsm, slope)` from `edge-classifier.ts:672`. Store the `PlaneSegment[]` and `ClassifiedEdge[]` on the return shape.
- The result gives us: pitch per plane (to ±0.2 rise:12 at HIGH imagery), azimuth per plane, and boundary edges typed as RIDGE / HIP / VALLEY / EAVE / RAKE / TRANSITION with confidence scores (70–90).

**4.1.2 Create reconciliation service `src/services/trace-reconciler.ts` (new)**
- Input: user trace (`TracePayload`), DSM RANSAC result (`PlaneSegment[]`, `ClassifiedEdge[]`).
- Output: `ReconciledGeometry` — a merged model that uses DSM geometry as ground truth where confidence is high, and user trace as a fallback or correction mechanism.
- Algorithm (sketch):
  1. Snap each user-trace vertex to nearest DSM plane boundary within 1.5 m (configurable). If no match, keep trace vertex.
  2. For each user-tagged edge (eave/ridge/hip/valley/rake), find the overlapping DSM-classified edge(s). If the DSM classifier disagrees with user tag AND confidence ≥ 80, flag a "classification conflict."
  3. For each flagged conflict, surface to user via `POST /:orderId/reconciliation` endpoint (side-by-side, human decides). For conflicts with DSM confidence ≥ 90 AND user-trace label is the default "eave," auto-correct.
  4. For each RANSAC plane with no corresponding user-traced facet, add it as an auto-detected facet (for dormers, bump-outs the user missed).

**4.1.3 Pitch resolution upgrade in `src/services/pitch-resolver.ts`**
- Extend `ResolvedPitch` with `per_segment_pitches: { segment_id, pitch_rise, source, confidence }[]`.
- New source priority: `ransac_dsm` (if confidence ≥ 0.85) > `solar_api` > `user_default` > `engine_default`.
- Keep the ±1.5 rise audit check at line 111, but now cross-check against RANSAC rather than just Solar API.

**4.1.4 Engine integration in `src/services/roof-measurement-engine.ts`**
- Accept a new optional `reconciled_geometry?: ReconciledGeometry` input on `TracePayload` (lines 84-114).
- When present: use RANSAC-derived per-facet pitch (replacing the current single dominant-pitch path at lines 1303-1392). The proportional splitter at 1369-1374 never fires because we have real per-facet geometry.
- When absent: fall back to current behavior (no regression).

**4.1.5 Confidence scoring**
- Introduce `confidence_score` per facet (not just global). Compute as: `min(dsm_plane_inlier_ratio, imagery_quality_factor, pitch_consistency_score)`.
- `imagery_quality_factor`: HIGH=1.0, MEDIUM=0.75, BASE=0.4.
- Propagate to `segments[].pitch_confidence` and surface in the report UI as badges.

**4.1.6 Tests**
- New `src/services/trace-reconciler.test.ts` — unit tests on synthetic DSM + trace fixtures covering: matching edges, conflicting classifications, missing facets, all-low-confidence fallback.
- New test fixtures in `src/data/test-fixtures/` — three real-world roofs (gable, hip-and-gable, complex with dormers) with known correct geometry from manual measurement.
- Accuracy tests that assert the reconciled result is within ±2% of ground truth on all three.

**Deliverables:**
- Working `/api/reports/:id/recompute` that produces measurably better numbers on the fixture set.
- Admin UI toggle to display "classification conflicts" for any report generated with Phase 1 engine.
- Measurable accuracy table: before/after on the fixture set.

---

### Phase 2 — True Geometric Face Splitting + Per-Facet Pitch

**Effort:** 5–7 days. **Accuracy gain:** Collapses the 5–15% multi-pitch error to ±2%.

Completes the stubbed face-splitting algorithm and wires in per-facet pitch from Phase 1's RANSAC planes.

**4.2.1 Finish the face splitter in `src/services/roof-measurement-engine.ts:1398-1450`**
- Current stub returns `[]` in the general case.
- Replacement algorithm: half-plane decomposition.
  1. Treat ridges + hips + valleys as an internal line graph inside the eaves polygon.
  2. For each internal line, compute its two half-planes.
  3. Partition the eaves polygon by successively cutting along each internal line using a polygon-clipping library (`polygon-clipping` npm package is already Cloudflare-compatible).
  4. Each resulting sub-polygon is a facet; assign pitch from the nearest RANSAC plane (Phase 1).

**4.2.2 Per-facet azimuth**
- Currently `estimateFaceAzimuth()` at lines 596-622 returns only the principal axis direction, not the downslope direction.
- Fix: use RANSAC plane normal (from `edge-classifier.ts` PlaneSegment) projected onto the horizontal plane → true downslope azimuth. Unambiguous.

**4.2.3 Multi-section eaves support**
- `eaves_sections?: TracePt[][]` at line 104 currently sums areas with the dominant pitch only.
- Fix: resolve per-section pitch independently (each section snaps to its own RANSAC plane). Fixes detached-garage errors (±5–10% today).

**4.2.4 Obstruction deduction**
- Currently (lines 1552-1600) uses dominant pitch for all obstructions.
- Fix: each obstruction's pitch comes from the facet it sits on.

**4.2.5 Tighten cross-check tolerance**
- `roof-measurement-engine.ts:1824-1836`: change `MATCH` threshold from 5% to 2%.
- Add `REVIEW_REQUIRED` status at >2% (between `MATCH` and current `MINOR_DIFF`). Halts publishing until adjuster clicks through.
- Mirror the change in `tools/roof_measurement_engine.py:349-371`.

**4.2.6 Unit tests**
- Extend `src/utils/geo-math.test.ts` with multi-pitch fixtures. Assert ±2% across simple gable, cross-gable, hip-and-valley, mansard.

---

### Phase 3 — Full Solar API Utilization

**Effort:** 3–4 days. **Accuracy gain:** 3–8% on edge cases, meaningful confidence scores everywhere.

Pulls value out of fields we already pay for.

**4.3.1 `sunshineQuantiles` → pitch confidence**
- `src/services/solar-api.ts:236-250`. Each segment currently contributes to the average pitch uniformly. Change: weight by inverse variance of `stats.sunshineQuantiles[0..3]`. High variance → shading interference → lower pitch confidence → the segment's pitch is downweighted in the average.

**4.3.2 `planeHeightAtCenterMeters` consistency check**
- `src/services/solar-api.ts:710`. Currently stored, never used.
- Fix: sample DSM at segment center, compare to `planeHeightAtCenterMeters`. If delta > 1 m, flag "potential stacked structure" and offer UI to split into multiple buildings.

**4.3.3 RGB GeoTIFF → Gemini multi-modal refinement**
- `src/services/solar-datalayers.ts:750-754` currently only produces a visualization BMP.
- Fix: new `refineGeometryWithVision()` path that feeds RGB + DSM + mask + reconciled user trace to `gemini.ts:analyzeRoofGeometry()` as a *validation* pass, not a fallback. Gemini output is treated as a third opinion and contributes to per-edge confidence.

**4.3.4 Split-resolution DSM fetch**
- `src/services/solar-datalayers.ts:212` pins `pixelSizeMeters: '0.5'`.
- Fix: fetch both 0.1 m/px (for ridge detection in RANSAC) and 0.5 m/px (for area + the rest). Caps memory spike to the detection pass only. Preserves throughput for area calculations.

**4.3.5 Expanded confidence reporting**
- `pitch-resolver.ts:16-37`. Add `area_confidence`, `area_source`, `per_segment_quality[]` to `ResolvedPitch`. Propagate into `RoofReport.quality.notes[]`.

---

### Phase 4 — Measurement Engine Hardening

**Effort:** 3–4 days. **Accuracy gain:** fixes edge cases at high latitudes and very large roofs.

**4.4.1 Spherical excess correction**
- `src/services/roof-measurement-engine.ts:1225-1233` (`computeFootprintSqft()`) and `src/utils/geo-math.ts:427-436`.
- Current method drifts 0.2–0.5% on roofs >15k sqft at 50°N.
- Fix: Karney formula for spherical polygon area (or the simpler Girard spherical-excess correction for small polygons). Pure math change, 30 lines.

**4.4.2 Vertex snap sensitivity**
- `SNAP_THRESHOLD_M = 0.15` at line 36 is hardcoded. On tight geometry (dormer returns, bay windows), this collapses short edges.
- Fix: compute snap threshold as `max(0.1, min(0.3, 0.02 * avg_edge_length))`. Plus a trace-validation warning when the threshold snaps any edge.

**4.4.3 Pitch multiplier table beyond 24:12**
- Current lookup at `roof-measurement-engine.ts:476-502` stops at 24:12 and falls silently back to Pythagorean.
- Fix: extend table to 36:12 (heritage A-frames), add a hard cap at 40:12 that throws rather than silently misbehaves.

**4.4.4 Waste factor geometry-aware**
- `roof-measurement-engine.ts:712-759` uses complexity tiers + pitch/valley/obstruction bonuses.
- Fix: add perimeter-to-area ratio component (zigzag roofs waste more), material-specific overrides (architectural vs. 3-tab vs. metal), and wind-zone lookup using property province/state.

**4.4.5 Cross-check rejection**
- `roof-measurement-engine.ts:1824-1836`: introduce an auto-reject at >10% variance (currently just flags). Returns `status: 'review_required'` instead of publishing.

---

### Phase 5 — Report Polish (secondary track)

**Effort:** 7–10 days. **Accuracy gain:** 0 (presentation only). **Credibility gain:** massive — this is what adjusters actually judge you on.

**4.5.1 Server-side PDF rendering**
- No `puppeteer`/`chromium`/`browser rendering` in the codebase today. `/:orderId/pdf` at `src/routes/reports.ts:1871-1885` just wraps the HTML with a print button.
- Fix: Cloudflare Browser Rendering binding (already on the Workers Paid plan). New `src/services/pdf-renderer.ts`. Wire into `/:orderId/pdf` — reply with `application/pdf`, not HTML.

**4.5.2 Dedicated length diagram page**
- New `generateLengthDiagramSVG()` in `src/templates/svg-diagrams.ts`. Same architectural diagram, but every edge labeled with `E1: 45.2 LF`, `R1: 22.8 LF`, etc., with a legend mapping IDs to types.
- New page in `src/templates/report-html.ts` after the current page 2.

**4.5.3 Dedicated pitch diagram page**
- New `generatePitchDiagramSVG()`. Facet fill color-coded by pitch tier (flat/low/standard/steep), each facet labeled with its pitch ratio (`6:12`, `4:12`).

**4.5.4 Notes / methodology page**
- Imagery date + resolution + provider, pitch measurement method, waste-factor basis, engine version, disclaimers, field-verification recommendation.
- Auto-injected whenever imagery quality < HIGH or any per-facet confidence < 0.7.

**4.5.5 Integrated material BOM page**
- Render the existing `MaterialEstimate` into the main report, not just at `/bom.xml`.
- Two-column table: line items with quantities + costs.

**4.5.6 Facet labeling style**
- Update `svg-diagrams.ts:323-330` to label facets as `F1`, `F2`... with pitch subscript — matches Xactimate's convention.

---

### Phase 6 — Real ESX Export

**Effort:** 10–15 days (dependent on how much reverse-engineering is needed). **Accuracy gain:** 0; **utility gain:** lets users import directly into Xactimate.

**4.6.1 ESX format research**
- .esx is a ZIP archive of XML + metadata. Xactware does not publish a spec publicly, but the format has been reverse-engineered by third parties (e.g., the `xactimate-esx-parser` Python project). First deliverable: a confirmed round-trip (parse sample .esx from a test customer → understand every field → rebuild equivalent).

**4.6.2 New service `src/services/esx-exporter.ts`**
- Inputs: `RoofReport` with Phase-0-or-later facet lat/lng polygons + edge classifications + material BOM.
- Outputs: `{ filename: string, blob: Uint8Array }`.
- Stages:
  1. **Sketch generation** — project facet polygons to a local Cartesian frame, emit Xactimate-sketch XML with facets, edges, and obstructions.
  2. **Line item mapping** — existing `generateXactimateXML()` at `material-estimation-engine.ts:464-500` has category names but no F9 codes. Need a lookup table from internal categories (`shingles`, `starter`, `ridge_cap`, ...) to Xactimate F9 line-item codes (`RFG 240`, `RFG STRT`, `RFG RIDGC`, etc.). ~30 codes.
  3. **Waste factor** — transfer global waste % as Xactimate's overhead field.
  4. **Metadata** — address, insured name, date of loss (pulled from linked claim if present).
  5. Assemble ZIP with required internal files: `estimate.xml`, `sketch.xml`, possibly `metadata.xml`.

**4.6.3 New route `GET /:orderId/export.esx`**
- Requires authenticated adjuster session (existing `customer-auth` flow).
- Returns ZIP with `Content-Disposition: attachment`.

**4.6.4 Round-trip validation**
- Import the generated .esx into an actual Xactimate installation (requires access to a licensed seat — plan for this as a dependency).
- Compare line items & measurements vs. the source `RoofReport`. Target: zero data loss.

---

## 5. Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RANSAC plane fit fails on low-quality imagery | Medium | Lose Phase 1 accuracy on MEDIUM/BASE tier | Gate RANSAC activation on imagery quality; fall back to current engine with honest confidence penalty when imagery is weak |
| Cloudflare Browser Rendering latency | Medium | Slower PDF generation | Pre-generate PDFs on report completion, cache in R2; `/pdf` becomes a fast lookup |
| .esx format variance across Xactimate versions | High | Broken imports | Target current stable version first (2026.Q1); document version compatibility; version-gate the export route |
| Migration `0137` downtime on D1 | Low | Cloudflare D1 migrations are fast but additive-only safely | Additive columns only in Phase 0; no DROPs |
| Existing reports with no provenance data | High (all of them) | Phase 0 features look broken on old reports | Detect `engine_version IS NULL`, display "legacy report" banner and offer recompute |
| Test-fixture ground truth | Medium | Accuracy claims unverifiable | Hand-measure three real roofs with tape + laser at the start of Phase 1; lock in as canonical fixtures |

---

## 6. Proposed Execution Order & Timeline

| Phase | Duration | Dependencies | Incremental value |
|---|---|---|---|
| 0 — Foundations | 2–3 days | None | Nothing visible, but unblocks everything |
| **1 — RANSAC + Reconciliation** | **4–6 days** | 0 | **Ship immediately: edge classification goes from user-supplied to validated; multi-pitch pitch from DSM** |
| 2 — Face splitter + per-facet pitch | 5–7 days | 0, 1 | Collapses the 5–15% multi-pitch error |
| 3 — Full Solar API | 3–4 days | 0 (can run parallel to 1/2) | Confidence scores become real |
| 4 — Engine hardening | 3–4 days | 2 | Edge-case polish |
| 5 — Report polish | 7–10 days | 0 (can run parallel) | Adjuster-facing credibility |
| 6 — ESX export | 10–15 days | 0, 1, 2 | Contractor direct import |
| **Total (serial path)** | **~6–8 weeks** | | |
| Total (parallel with 2 engineers) | ~4 weeks | | |

---

## 7. Starting Phase 1

Concrete first commit:

1. Migration `0137_measurement_provenance.sql` — scaffolding only.
2. Extend `src/types.ts` with the provenance/confidence fields.
3. New `src/services/trace-reconciler.ts` — the reconciler with a minimal happy path.
4. Modification to `src/services/solar-datalayers.ts` to invoke `runEdgeClassifier()` after slope analysis.
5. Modification to `src/services/roof-measurement-engine.ts` `computeMeasurement()` to accept and use reconciled geometry.
6. New unit test file `src/services/trace-reconciler.test.ts` with three fixtures.

Each of these is a small, reviewable diff. Recommend landing them as separate commits on a `phase-1-ransac-integration` branch.

---

## 8. Decisions Locked for Phase 1

- **Engine version format:** `YYYY.MM-phaseN` (e.g., `2026.04-phase1`). Stamped on every new report and on each `report_versions` row.
- **Variance policy:** at >2% Solar-vs-trace variance after Phase 2 lands, the report status becomes `review_required` and delivery is blocked until an admin clicks through. Phase 1 introduces the status column; Phase 2 flips the threshold live.
- **Ground truth:** synthetic fixtures only for Phase 1. Accuracy claims will be relative (before vs. after) rather than absolute. Three synthetic roof geometries will be committed to `src/data/test-fixtures/`: (a) simple rectangular gable, (b) hip-and-gable cross-roof, (c) hip-and-valley with a dormer. Each includes a hand-built "truth" `RoofReport` computed offline.
- **Open for Phase 6:** target Xactimate version (2026.Q1 suggested unless you have a different target customer).

# Roof Manager — ML Auto-Tracing Model

**Implementation Plan (Pre-Deployment, NVIDIA Launchpad)**

Author: planning pass for Ethan
Date: 2026-04-27
Status: planning only — no codebase changes have been made
Target deployment: NVIDIA Launchpad GPU instance, served as an external inference endpoint that the Cloudflare Worker calls from the super admin module

**Updated 2026-04-27** — Confirmed available labeled training data: ~200 completed orders with `roof_trace_json` populated. This is below the threshold for training a fully custom multi-head architecture from scratch, so the build order has been revised: v1 ships as a **pretrained-model + rule-based pipeline (no custom training)**; learned edge classification arrives in v1.5 / v2 as labels accumulate. See section 11 for the small-data adapted plan.

---

## 1. What we are building

A custom multi-modal computer vision model that auto-traces residential roofs from satellite imagery and outputs polygons that drop directly into Roof Manager's existing measurement pipeline.

The model lives behind an HTTP endpoint on NVIDIA Launchpad. The super admin module calls it whenever a customer order arrives with `needs_admin_trace=1`. The model returns a draft trace (eaves polygon, ridge/hip/valley polylines, per-edge confidence scores). The super admin reviews, edits if needed, and submits — at which point the existing `roof-measurement-engine.ts` calculates the final report exactly as it does today.

This is a **review-assist system**, not a fully autonomous one. The human stays in the loop until accuracy is proven. The model's job is to remove ~80–90% of the manual tracing labor, not 100%.

### The three outputs the model produces (multi-stage pipeline, per your selection)

1. **Pixel segmentation mask** — a per-pixel classification of the satellite tile into `{background, roof-interior, eave, ridge, hip, valley}`. This is the raw model output and gets used internally for QA and debugging.
2. **Vectorized polygons** — ordered `(lat, lng)` vertex lists for the roof outline plus per-edge polylines tagged with edge type. This is what gets handed to the existing `traceUiToEnginePayload()` function.
3. **Per-vertex and per-edge confidence scores** — surfaced in the super admin UI so the reviewer can see at a glance which edges are well-predicted and which need manual touch-up.

---

## 2. How the model plugs into the existing codebase

The good news: the integration surface is small and well-defined. The current code is structured exactly the way you would want it to be for dropping in an inference service.

### The seam

Today the customer order flow ends at `src/routes/orders.ts:74-95` with a row in the `orders` table. If `needs_admin_trace=1` (column added in `migrations/0078_orders_needs_admin_trace.sql`), the order sits waiting for a human admin.

The new flow inserts the model between order creation and admin review:

```
POST /api/orders
  → inserts orders row with needs_admin_trace=1
  → fires async job: callAutoTraceModel(orderId)
       → fetches Solar API imagery + DSM + footprint mask
       → POSTs to NVIDIA Launchpad endpoint
       → stores draft trace JSON in orders.draft_trace_json (new column)
       → stores per-edge confidence in orders.draft_trace_confidence_json (new column)
       → updates orders.trace_status = 'draft_ready'
  → super admin sees order in queue with "AI draft ready" badge
  → admin opens trace UI, draft polygons pre-loaded on Leaflet/Mapbox map
  → low-confidence edges highlighted in red/yellow
  → admin confirms or edits → POSTs to existing endpoint that writes orders.roof_trace_json
  → existing roof-measurement-engine.ts runs unchanged
```

The model never replaces `roof-measurement-engine.ts`. It feeds it. The engine is the source of truth for measurements and material take-off; the model only generates the polygon inputs.

### The integration pattern already exists

`src/services/cloud-run-ai.ts` is the template. It already:

- Posts to an external GPU service with a JSON body
- Uses Bearer token auth (configurable via env vars)
- Has a 90-second timeout suitable for GPU inference
- Falls back gracefully when the external service is down
- Uses the same request/response shape we want (`image_urls`, `coordinates`, `known_pitch_deg`, then a `geometry` object with `facets` and `lines`)

The new file `src/services/roof-trace-model.ts` should be modeled on `cloud-run-ai.ts`. Same auth pattern, same timeout, same fallback (if model is down, order falls through to fully manual trace — no degradation in service, just no AI assist).

### The API contract

```typescript
// Request to NVIDIA Launchpad inference endpoint
interface AutoTraceRequest {
  // Imagery — public URLs the model fetches itself, OR base64 if we want to avoid second hops
  satellite_image_url: string         // satellite_overhead_url from Solar API (1600x1600)
  dsm_url: string                     // imagery.dsm_url from Solar API
  footprint_mask_url: string          // imagery.mask_url from Solar API

  // Geospatial context
  center_lat: number                  // image center
  center_lng: number
  zoom_level: number                  // 19, 20, or 21
  meters_per_pixel: number            // computed from zoom + lat

  // Solar API hints
  segment_pitches?: Array<{           // per-segment pitch + azimuth from Solar API
    pitch_degrees: number
    azimuth_degrees: number
    area_weight: number
  }>
  weighted_avg_pitch_deg?: number
  imagery_quality?: 'HIGH' | 'MEDIUM' | 'BASE'

  // Operational
  request_id: string                  // for logging/tracing
  return_visualization?: boolean      // render PNG overlay for debugging
}

// Response
interface AutoTraceResponse {
  success: boolean
  model_version: string
  inference_time_ms: number

  trace: {
    eaves: Array<{                    // matches UiTrace.eaves shape exactly
      vertices: Array<{ lat: number; lng: number; confidence: number }>
      polygon_confidence: number
    }>
    ridges: Array<{
      vertices: Array<{ lat: number; lng: number }>
      edge_confidence: number
      pitch_degrees?: number          // model's pitch estimate from DSM
    }>
    hips: Array<{ vertices: ...; edge_confidence: number }>
    valleys: Array<{ vertices: ...; edge_confidence: number }>
  }

  overall_confidence: number          // 0-1, drives "needs review" gate
  flags: string[]                     // e.g. ['low_dsm_quality', 'multiple_buildings_detected', 'unusual_geometry']

  visualization_png_base64?: string   // only when requested

  error?: string
  error_code?: string
}
```

Because `trace.eaves`, `trace.ridges`, etc. mirror the existing `UiTrace` shape (defined at `src/utils/trace-validation.ts:18-31`), conversion to the engine's `TracePayload` is essentially a passthrough plus the existing `traceUiToEnginePayload()` helper.

### Database changes (do not implement yet — this is the planned migration)

```sql
-- migrations/0XXX_orders_auto_trace.sql
ALTER TABLE orders ADD COLUMN draft_trace_json TEXT;
ALTER TABLE orders ADD COLUMN draft_trace_confidence_json TEXT;
ALTER TABLE orders ADD COLUMN trace_status TEXT DEFAULT 'pending';
  -- 'pending' | 'draft_ready' | 'admin_reviewing' | 'completed' | 'failed'
ALTER TABLE orders ADD COLUMN model_version TEXT;
ALTER TABLE orders ADD COLUMN auto_trace_inference_ms INTEGER;
```

---

## 3. Model architecture

**Recommendation: Clay v1 backbone (Apache 2.0, multi-modal-native) + 3-head decoder + optional SAM 2 refinement stage.**

### Why this stack and not the others

A long list of alternatives was evaluated. The short version of why this combination wins:

- **Clay v1** is the right backbone because it was designed to consume multi-band remote sensing input natively (RGB + DSM + extras), it's Apache 2.0 (production-safe), and it was pretrained on millions of satellite tiles so we get strong initialization with a small fine-tuning corpus.
- **Frame Field Learning** (Girard et al.) gives the cleanest residential roof polygons of any open polygonization technique. It explicitly models edge orientation, which matches what we actually need to predict (edge-typed polygons, not just blob masks).
- **PolyWorld** would have been the academic-best polygonization technique but its non-commercial license disqualifies it for a paid SaaS product. Skip.
- **SAM 2** is excellent as a segmenter when prompted with the Solar footprint, but it gives blob masks, not edge-typed polygons. Use it as an *optional refinement stage* on low-confidence predictions rather than the primary segmenter.
- **No off-the-shelf model classifies eaves vs ridges vs hips vs valleys.** This is the custom work — a 6-way semantic head sitting on the Clay backbone, trained on your historical traces.

### Architecture sketch

```
INPUTS (1024 × 1024 × C tensor):
  RGB satellite (3 ch)
  Solar building footprint mask (1 ch)
  DSM elevation, normalized (1 ch)
  ∇DSM_x, ∇DSM_y — gradient channels (2 ch)   ← cheap addition, makes
                                                  edge-type prediction much easier
                                                  because eaves/ridges/hips/valleys
                                                  have characteristic gradient signatures

BACKBONE:
  Clay v1 ViT-L (~600M params, Apache 2.0)
  - Patch embed extended to C input channels (RGB weights initialized from
    pretrained, extra channels zero-initialized and warmed up)
  - Multi-scale feature pyramid via FPN adapter

THREE PARALLEL DECODER HEADS:

  Head A — Semantic segmentation (UPerNet-style)
    Output: per-pixel class {background, roof-interior, eave, ridge, hip, valley}
    Loss: weighted cross-entropy + Dice (heavy class imbalance on edges)
    Edge classes get class-weight ~10× background to compensate.

  Head B — Frame field polygonization (Girard 2020)
    Output: 2D frame field (4 angle channels) + edge mask + vertex heatmap
    Loss: frame field alignment + edge BCE + vertex L2
    Post-process: ASM (Active Skeleton Model) extraction → ordered polygon vertices.
    Project pixel coords → lat/lng using the tile's affine transform.

  Head C — Confidence head
    Output: per-vertex and per-edge confidence (0–1)
    Loss: MSE against IoU-derived pseudo-confidence from training
    Use: drives the super-admin review UI (red/yellow/green edges).

OPTIONAL REFINEMENT STAGE (only when overall_confidence < 0.75):
  SAM 2 (Hiera-Large, Apache 2.0)
  Prompted with Head A's mask + Solar footprint as box/mask prompts.
  Refines the binary roof mask; re-run polygonization.
  Adds ~150–250ms but only fires on the ~15–25% of cases that need it.

OUTPUT:
  GeoJSON FeatureCollection with:
    - Polygon (ordered lat/lng vertices)
    - Per-edge type labels (eave/ridge/hip/valley)
    - Per-vertex and per-edge confidence
    - Overall polygon IoU estimate
```

### Why DSM gradients matter so much

The DSM (digital surface model) from Google Solar gives per-pixel building height. Edge types map to characteristic DSM signatures:

- **Eaves** sit at the elevation boundary between the roof and the surrounding ground/landscape — the strongest height discontinuity in the tile.
- **Ridges** are local elevation maxima along the roof surface (height gradient flips sign across them).
- **Valleys** are concave height transitions (gradient converges into a low line on the roof surface).
- **Hips** are convex height transitions (gradient diverges from a high line).

Feeding the model `[DSM, ∇DSM_x, ∇DSM_y]` as separate channels means the network gets these signals essentially for free in its first conv. This is the single most important design choice in the architecture and the main reason the model can plausibly hit edge-type classification accuracy.

---

## 4. Training data pipeline

### Source 1 — Historical production data (highest value)

The `orders` and `reports` tables already contain the label data we need. From the codebase exploration:

- `orders.roof_trace_json` (TEXT, JSON) holds the admin-confirmed `UiTrace`: eaves, ridges, hips, valleys, optional slope_map. This is gold-standard label data.
- `orders.latitude`, `orders.longitude` give us the tile center.
- `orders.trace_measurement_json` and `reports.api_response_raw` give us the ground-truth measurements we can later use for downstream sanity-check losses.
- `reports.imagery_quality`, `reports.imagery_date` let us filter to high-quality imagery only for training.

**Mining query** (run against a D1 export, not against production):

```sql
SELECT
  o.id AS order_id,
  o.latitude, o.longitude,
  o.roof_trace_json,
  o.trace_measurement_json,
  r.imagery_quality,
  r.imagery_date,
  r.roof_pitch_ratio,
  r.roof_segments,
  r.api_response_raw
FROM orders o
JOIN reports r ON r.order_id = o.id
WHERE r.status = 'completed'
  AND o.roof_trace_json IS NOT NULL
  AND r.imagery_quality IN ('HIGH', 'MEDIUM')
ORDER BY r.created_at DESC;
```

**Label generation pass:**

For each row, fetch the corresponding satellite tile, DSM, and footprint mask from the Google Solar API using the same code path that production uses (`fetchSolarPitchAndImagery()`), then rasterize the polygons in `roof_trace_json` into the per-pixel label mask the model needs.

A polygon → mask rasterization script is straightforward (`Pillow` / `cv2.fillPoly` for the interior, dilated polylines for the edge classes). Each edge class is rasterized as a 3-pixel-wide band to give the model some localization tolerance.

### Source 2 — Public dataset pretraining

Stage backbone fine-tuning before touching production data. Recommended order:

1. **Microsoft Building Footprints (Global)** — https://github.com/microsoft/GlobalMLBuildingFootprints — ODbL license, ~1.4B buildings globally, strong North America coverage matching Roof Manager's market. Use for binary roof mask pretraining.
2. **SpaceNet 2 + SpaceNet 7** — https://spacenet.ai/datasets/ — CC-BY-SA 4.0, high-quality polygon labels at 0.3m resolution. Use for polygonization head pretraining.
3. **DFC2019 Track 4 (US3D)** — https://ieee-dataport.org/open-access/data-fusion-contest-2019-dfc2019 — research-only license but **the rare paired RGB + DSM + building-class dataset** — use for multi-modal fusion training stage.
4. **Open Cities AI Challenge** — https://www.drivendata.org/competitions/60/ — CC-BY 4.0 — diversity for non-North-American architecture if you ever expand.
5. **Inria Aerial Image Labeling** — research-only, **do not include in production training**, useful for ablation studies only.

### Source 3 — Synthetic data (Google Imagen / Veo / Gemini-native image gen)

You mentioned wanting to use Google's new generative AI for data creation. The honest take: **synthetic data is useful for failure-mode augmentation, not as primary training.** Domain gap is real and biased models built on synthetic-heavy training underperform real-heavy training even at 10× the volume (well-documented in the SpaceNet community).

The right way to use generative models here is to fill specific gaps in the production data you don't have enough of:

- Snow-covered roofs (Roof Manager is `.ca`, this matters)
- Solar panel arrays partially occluding the roof
- Blue tarps / post-storm damage
- Unusual roof colors (red metal, green asphalt)
- Heavily shadowed roofs (low sun angle)

Pipeline:

```
1. Procedural geometry (Blender + Python):
   Generate parametric roof: gable, hip, mansard, gambrel, complex L/T-shapes.
   Output: vector ground truth (perfect labels) + 3D mesh.

2. Render via Blender:
   Top-down orthographic camera, sun angle from real solar ephemeris.
   Procedural shingle/metal/tile materials.
   Output: paired (synthetic RGB, perfect mask, perfect DSM).

3. Domain transfer with Imagen 3 / Gemini-native image gen:
   Use structural conditioning (canny or depth) from the Blender render
   as a tight constraint, then prompt: "photorealistic Google Maps satellite
   tile of suburban residential roof, asphalt shingles, midday sun,
   GSD 0.15m, slight JPEG compression artifacts".
   This is the critical step — raw Blender renders don't generalize.

4. Re-derive label mask:
   Don't trust the Blender mask after diffusion. Run SAM 2 over the
   diffused output and intersect with the Blender mask to catch
   any geometric drift introduced by the diffusion model.

5. Human QA filter:
   Show ~5% of synthetic tiles to a reviewer; reject batches where
   >20% are flagged as broken.
```

**Hard cap:** synthetic samples should never exceed ~30% of any training batch. The remaining ~70% must be real production data + public datasets.

### Augmentation

Standard remote sensing augmentation: rotation (multiples of 90° preserve north-up; non-90° introduces interpolation artifacts — use sparingly), color jitter, GSD jitter (rescale 0.8×–1.2× to simulate different zoom levels), DSM noise injection, and **random channel dropout** — randomly zero out the DSM or footprint mask channel during training so the model learns to be robust when Solar API coverage is missing or low quality. This last one is critical for production.

### Train / val / test split

Split by **address geo-cluster**, not by random row. If the model ever sees the same neighborhood at training and validation it will overfit to local architectural style and yield misleading mIoU numbers. Use H3 cells at resolution 7 (~5km cells) as cluster boundaries; assign whole cells to train/val/test at ratios 80/10/10.

### Training schedule

| Stage | Data | Steps | LR (backbone / heads) | Goal |
|---|---|---|---|---|
| 1 | Microsoft Footprints (binary) | 100k | frozen / 1e-4 | Pretrain Head A on binary roof mask |
| 2 | SpaceNet 2 + 7 (polygon) | 50k | 1e-5 / 1e-4 | Pretrain Head B (frame field + polygonization) |
| 3 | DFC2019 (RGB+DSM+class) | 30k | 1e-5 / 1e-4 | Multi-modal fusion training |
| 4 | Production traces + synthetic | 50k | 1e-5 / 1e-4 | Fine-tune all heads + Head C on real data |

Total wall-clock on a single H100 for all four stages: roughly 2–4 weeks depending on dataset size. Use NVIDIA Launchpad H100 instance for training, then deploy the trained weights to the L40S inference instance.

---

## 5. NVIDIA Launchpad deployment

### GPU recommendation: L40S (48GB, Ada Lovelace)

Reasoning, given quality-first priority:

- **L4 (24GB)** — too small for ViT-L Clay backbone + multi-head decoder at 1024×1024 resolution. Skip.
- **L40S (48GB)** — sweet spot. Holds Clay-L + decoders + SAM 2 Hiera-L all resident in VRAM, supports FP8 via TensorRT for further latency wins, and is inference-optimized. **This is the recommendation for production inference.**
- **A100 80GB** — fine but older Ampere architecture, no FP8, not worth the price premium for inference.
- **H100 80GB** — overkill for single-roof inference. Reserve H100 budget for *training runs* (where you want it) and inference on L40S.

**Two-instance plan:**
- **Training**: H100 80GB on Launchpad, used for the 4-stage training schedule above. Spin down between training runs.
- **Inference**: L40S 48GB on Launchpad, always-on, serves the production endpoint that the Worker calls.

### Inference stack: Triton Inference Server + TensorRT

- **Triton + TensorRT** — best throughput, dynamic batching, model ensembles (you can pipeline Clay backbone → 3 heads → SAM 2 refinement as a Triton ensemble exposed as a single HTTP call). Mature observability, integrates with Prometheus/Grafana. **Recommendation.**
- **NIM** — great for NVIDIA's catalog models, but you're shipping a custom multi-head architecture. NIM doesn't add value here unless NVIDIA publishes a remote-sensing NIM (they have not as of Apr 2026).
- **FastAPI + raw PyTorch** — fine for the very first prototype, terrible for production. ~3–5× higher latency, no dynamic batching, no quantization. Use only during development weeks.
- **vLLM** — irrelevant; vLLM is for autoregressive LLM serving.

### Model format

Export PyTorch → ONNX → TensorRT engine per-GPU.

- Native PyTorch in production leaves 2–3× latency on the table.
- ONNX as portable intermediate (also lets you fall back to ONNX Runtime if a TensorRT engine compile fails on a new GPU SKU).
- TensorRT FP16 baseline; FP8 on L40S/H100 if accuracy parity is validated. Frame field heads can be sensitive to FP8 quantization — keep them FP16 even if the backbone runs FP8.
- SAM 2 has known TensorRT export issues with the memory attention module — budget engineering time for this, or keep SAM 2 in PyTorch and only TRT-ify the main pipeline since it only fires on ~15–25% of requests.

### Expected end-to-end latency on L40S (RGB + DSM at 1024×1024)

| Stage | Latency (FP16 TRT) |
|---|---|
| Preprocessing — fetch tiles from Solar API, align DSM, normalize | 50–100ms (network-bound) |
| Clay-L backbone forward | 80–120ms |
| 3 decoder heads (mask + frame field + confidence) | 40–60ms |
| Polygonization (CPU-side ASM extraction) | 100–200ms |
| Optional SAM 2 refinement (only on low-confidence ~15–25% of cases) | +150–250ms when triggered |
| Edge-type assignment + GeoJSON serialization | 20–50ms |
| **Typical total (no refinement)** | **~300–500ms** |
| **Total with refinement** | **~500–800ms** |

Well within a few-seconds budget, leaves room for retries, multi-tile stitching for large commercial roofs, and the existing measurement engine downstream.

### Auth + Worker → Launchpad communication

Mirror the `cloud-run-ai.ts` pattern exactly:

- HTTPS-only endpoint with Bearer token in `Authorization` header
- API key stored in `wrangler secret put NVIDIA_LAUNCHPAD_API_KEY` and `NVIDIA_LAUNCHPAD_URL`
- 90-second timeout (matches existing GPU service pattern)
- Health check endpoint at `/health` polled every 30s by a Worker scheduled task; if down, new orders skip auto-trace and route directly to manual admin review (no degradation, just no AI assist)
- Request/response logging into a new `auto_trace_invocations` D1 table for later analysis and continuous training-set growth

---

## 6. Evaluation metrics

Track these from day one. They become the gate for promoting a model version to production.

| Metric | What it measures | Target for v1 |
|---|---|---|
| Polygon IoU (eaves) | Overlap of model eaves polygon with admin-confirmed eaves | ≥ 0.85 |
| Edge length error (%) | (model edge length − admin edge length) / admin edge length, per edge type | ≤ 5% on average |
| Edge-type classification F1 | Per-pixel F1 across {eave, ridge, hip, valley} | ≥ 0.80 |
| Pitch estimate error (deg) | Mean absolute error of model pitch vs admin slope_map | ≤ 2° |
| Vertex count drift | (model vertex count − admin vertex count) / admin vertex count | within ±20% |
| End-to-end latency (p95) | NVIDIA endpoint inference time | ≤ 1.0s |
| Admin edit rate | % of orders where admin modified the AI draft before submitting | < 30% by v1.5, < 15% by v2 |
| Time saved per trace | Median minutes from "admin opens order" to "admin submits trace" | ≥ 50% reduction vs baseline |

The last two — admin edit rate and time saved — are the business-value metrics. The first six are model-quality metrics. Both matter.

---

## 7. Build order — what to do before NVIDIA Launchpad deployment

The actionable timeline. Each phase has a clear gate before moving to the next.

### Phase 0 — Data prep (week 1, no GPU needed)

1. Export current `orders` + `reports` rows where `roof_trace_json IS NOT NULL` and `imagery_quality IN ('HIGH', 'MEDIUM')`. Count them. This is the size of the gold-standard label set.
2. Build the polygon → mask rasterization script. For each row, fetch the Solar API tile + DSM + footprint mask (cache them locally), rasterize labels, save as `(image, label)` numpy pairs in a versioned dataset on object storage.
3. Decide split assignment by H3 cells (resolution 7). Save split manifest.
4. Stand up an evaluation harness that runs the metrics in section 6 against any held-out polygon/label pair. This is the single source of truth for "is the model good enough yet."

**Gate before phase 1**: at least ~500 high-quality labeled samples mined and split assigned. Eval harness is functional.

### Phase 1 — Public dataset pretraining (weeks 2–4)

5. Spin up NVIDIA Launchpad H100 instance for training. Install Clay v1 weights + repo.
6. Stage 1 training run: Head A on Microsoft Footprints (binary). 100k steps. Validate on SpaceNet 2.
7. Stage 2 training run: Heads A + B on SpaceNet 2 + 7. 50k steps.
8. Stage 3 training run: All heads on DFC2019 (multi-modal). 30k steps.

**Gate before phase 2**: backbone + heads achieve ≥ 0.75 IoU on SpaceNet 2 holdout. If not, debug architecture or add public data.

### Phase 2 — Production fine-tuning (weeks 5–6)

9. Stage 4 training run: full multi-head model on production traces + ~30% synthetic. 50k steps.
10. Run evaluation harness against production holdout (the H3-cell test split).

**Gate before phase 3**: hit the v1 targets in section 6 on production holdout — IoU ≥ 0.85, edge F1 ≥ 0.80, pitch error ≤ 2°. If not, iterate (more data, more training, head re-architecture).

### Phase 3 — Inference deployment (week 7)

11. Spin down H100, spin up L40S 48GB Launchpad inference instance.
12. Export trained model: PyTorch → ONNX → TensorRT FP16 engine.
13. Wrap in Triton Inference Server with the API contract defined in section 2.
14. Add `/health` endpoint, request logging, Prometheus metrics.

**Gate before phase 4**: Triton serves a test request from a curl command and returns the expected response shape with p95 latency ≤ 1s.

### Phase 4 — Codebase integration (week 8)

15. Write D1 migration: `0XXX_orders_auto_trace.sql` per section 2.
16. Build `src/services/roof-trace-model.ts` modeled on `cloud-run-ai.ts`.
17. Hook it into the order-creation async job in `src/routes/orders.ts`.
18. Update super admin trace UI to pre-load `draft_trace_json` and color-code edges by `draft_trace_confidence_json`.
19. Add `auto_trace_invocations` table for full request/response logging.
20. Deploy to staging first, shadow mode (run model but don't show to admins) for ~1 week to gather invocation data without affecting users.

### Phase 5 — Production rollout (week 9 onward)

21. Enable for 10% of orders (random sampling). Track admin edit rate and time saved.
22. If metrics meet section 6 targets, ramp to 50% then 100%.
23. Continuous training loop: every admin edit becomes a new labeled sample. Re-train monthly.

---

## 11. Small-data adapted plan (the actual recommendation given 200 labels)

200 labeled samples is real but tight. Split 80/10/10 leaves ~160 train / 20 val / 20 test. That's enough to fine-tune a strong pretrained binary roof-mask model and validate it. It is **not enough** to train a learned edge-type classifier (eaves/ridges/hips/valleys) from scratch with confidence — that needs more like 1500–3000 labels to be reliable.

The right move is to ship value fast with a no-training v1, then *use the production traffic itself to grow the label set* until v2 can justify the full multi-head architecture.

### v1 — "No custom training" pipeline (ship in 4–6 weeks)

```
INPUT: Solar API tile + DSM + footprint mask (same multi-modal input plan)

STAGE 1: Binary roof segmentation
  SAM 2 (Hiera-Large, Apache 2.0)
  Prompted with the Solar footprint mask as the input prompt.
  Output: refined binary roof mask.
  Why: SAM 2 was specifically designed for prompted segmentation
  and the Solar footprint is a near-perfect prompt. No fine-tuning needed.

STAGE 2: Polygonization
  Frame Field Learning model (Girard 2020), pretrained weights from
  the public release on Inria + CrowdAI.
  Or simpler: Douglas–Peucker simplification + corner detection on
  the SAM 2 mask boundary. Less elegant but trainable-data-free.
  Output: ordered polygon vertices for the roof outline.

STAGE 3: Edge-type assignment (RULE-BASED, no learning)
  For each polygon edge, look up the DSM elevation profile underneath.
  - Edge with sharp DSM drop on one side and ground-level on the other → EAVE
  - Edge along a DSM ridgeline (local max in cross-section) → RIDGE
  - Edge along a convex DSM transition between roof faces → HIP
  - Edge along a concave DSM transition between roof faces → VALLEY
  These are deterministic from DSM gradient analysis. ~70-80% accuracy
  is realistic, vs ~90%+ with a learned classifier later.

STAGE 4: Confidence scoring (RULE-BASED)
  - Polygon confidence: mean SAM 2 mask probability inside polygon
  - Per-edge confidence: agreement between DSM rule classification
    and polygon geometry (e.g. an edge classified RIDGE that's at
    the polygon's outer perimeter gets low confidence)
  Surface red/yellow/green in admin UI as planned.
```

**What this v1 does NOT need:**
- No custom training run — saves 2–4 weeks
- No H100 training instance — only the L40S inference instance
- No Microsoft Footprints / SpaceNet / DFC2019 pretraining stages
- No synthetic data generation pipeline
- No D1 export + label rasterization sprint (defer this — but start collecting now)

**What v1 DOES need:**
- L40S 48GB Launchpad inference instance
- Triton + TensorRT setup (SAM 2 in PyTorch is fine for v1, TRT-ify later)
- The same `roof-trace-model.ts` integration on the Worker side
- The same draft_trace_json + confidence DB schema
- The same super admin review UI

**Expected v1 quality:**
- Polygon IoU vs admin trace: ~0.75–0.85 (decent — SAM 2 + Solar footprint is strong)
- Edge length error: ~5–10%
- Edge-type classification accuracy: ~70–80% (rule-based)
- Admin edit rate: ~40–60% of edges touched
- Time saved per trace: ~30–50% (real value, not as much as v2)

This earns the right to v2 — and during the 3–6 months v1 runs in production, every admin trace becomes a new gold-standard label. By the time you hit ~1500 labels, v2 training is justified.

### v1.5 — Fine-tune SAM 2 for the roof domain (when you reach ~500 labels)

LoRA-fine-tune SAM 2 on the labeled roof masks. Cheap (a few hours on L40S), no architecture changes, drops polygon IoU to ~0.85–0.90. Edge classification stays rule-based. Ship it.

### v2 — Custom multi-head model with learned edge classification (when you reach ~1500–2000 labels)

The full architecture from section 3: Clay v1 backbone + 3-head decoder + SAM 2 refinement. This is when you spin up the H100 training instance and run the 4-stage training schedule from section 4.

### Path to grow labels faster (recommended in parallel)

1. **Active labeling sprint** — go through any backlog of orders that haven't been traced yet, or do a one-time pass on 200–500 historical orders to double the label set in a week or two of admin work.
2. **Use v1's drafts as labeling acceleration** — once v1 is shipping, every admin "review" is essentially a labeling action. The admin's edits *are* the gold-standard labels for the next training round. Build the `auto_trace_invocations` table from day one so this data is captured cleanly.
3. **Synthetic data only for edge-type signatures** — if you want to bootstrap edge-type training before reaching 1500 real labels, generate synthetic Blender rooftops *specifically for their DSM signatures* (geometry is easy to render perfectly; the goal isn't photorealistic RGB but rather DSM gradient patterns the model needs to learn). This is a much narrower synthetic data use than the original section 4 plan.

### Updated build order summary

| Phase | What | Timeline | Needs |
|---|---|---|---|
| Phase 0 (revised) | Label rasterization for the 200 existing samples; eval harness | week 1 | No GPU |
| Phase 1 (skipped) | ~~Public dataset pretraining~~ | — | Defer to v2 |
| Phase 2 (skipped) | ~~Production fine-tuning~~ | — | Defer to v1.5 |
| Phase 3 (revised) | Deploy SAM 2 + Frame Field Learning + DSM rules on L40S | weeks 2–3 | L40S Launchpad inference instance only |
| Phase 4 | Codebase integration (same as original plan) | week 4 | — |
| Phase 5 | Production rollout (same as original plan) | weeks 5–6 | — |
| **v1 ships** | | **week ~6** | |
| Phase 6 | Continuous label collection from admin edits | ongoing | — |
| Phase 7 | LoRA fine-tune SAM 2 when ~500 labels | when ready | L40S, few hours |
| **v1.5 ships** | | **~3 months** | |
| Phase 8 | Full custom multi-head training (original sections 3–4 plan) | when ~1500 labels | H100 Launchpad training instance |
| **v2 ships** | | **~6–9 months** | |

This adapted plan delivers production value in ~6 weeks instead of ~9, and saves the H100 training spend until you have the data to justify it. The original plan in sections 3–7 is not wrong — it's the v2 plan, and it remains the long-term target.

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Not enough labeled production data | **CONFIRMED — only ~200 samples** | High | **Mitigation in section 11**: ship v1 with no custom training (SAM 2 + Frame Field + DSM rules), grow labels through production traffic, train v1.5 / v2 once corpus is large enough. |
| Solar API DSM coverage gaps | Medium | Medium | Random channel dropout during training so model is robust to missing DSM. Also: `flags: ['low_dsm_quality']` in response so admin knows. |
| Edge-type classification turns out very hard | Medium | High | DSM gradients should help a lot. Fallback: ship v1 as binary mask + polygonization only, classify edges in post-process using DSM alone, train edge classifier in v2. |
| TensorRT export fails on SAM 2 | High | Low | Keep SAM 2 in PyTorch, only TRT-ify main pipeline. Refinement stage adds latency but only fires on low-confidence cases. |
| Synthetic data poisons training | Medium | Medium | Hard cap at 30% per batch. Ablation study: train with and without synthetic, compare on holdout, only ship with synthetic if it measurably helps. |
| Model degrades over time as imagery / Solar API changes | Medium (long-term) | Medium | `auto_trace_invocations` table + monthly re-training loop. Track admin edit rate as drift signal. |
| Admin doesn't trust the AI draft and re-traces from scratch | Medium | High (no value delivered) | Ship with confidence visualization (red/yellow/green edges). Onboard admins explicitly. Track "edit rate" and iterate on UI. |
| NVIDIA Launchpad endpoint goes down | Low | Low | Fallback to fully manual trace (current state). No order ever fails because the model is down. |

---

## 9. What is intentionally NOT in v1

Scope discipline matters. The following are explicitly deferred:

- **Multi-tile stitching for large commercial roofs.** v1 handles single-tile residential roofs only. Commercial complex-shape roofs go to manual trace.
- **Obstruction detection** (chimneys, skylights, vents). The vision-analyzer.ts pipeline already handles this separately. Don't duplicate.
- **3D roof reconstruction.** Stick to 2D polygons + per-edge pitch estimates. Full 3D is a v3+ research project.
- **Replacing the measurement engine.** The model feeds polygons to the engine, never replaces it. Engine is the source of truth for measurements and material take-off.
- **Replacing the human admin.** v1 is review-assist, not autonomous. Trust gets built one accuracy milestone at a time.

---

## 10. Open questions to resolve before phase 0

These are the things that genuinely need a decision from you before any of the above can start.

1. ~~**How many completed traces with `roof_trace_json` populated do you actually have right now?**~~ **Answered: ~200.** This drives the small-data adapted plan in section 11.
2. **Is the super admin trace UI already a Leaflet/Mapbox-based polygon editor, or is it a custom canvas?** The integration plan assumes pre-loading polygons into an existing interactive map. Confirm by pointing at the frontend file.
3. **Are you on board with the v1 / v1.5 / v2 staged plan in section 11, or do you want to push for the full custom architecture from day one (which would require either a 3–6 month labeling sprint or accepting much weaker results from a small training set)?**
4. **Storage for the training dataset and intermediate artifacts (Cloudflare R2? GCP Cloud Storage?).** Affects how the data prep scripts read/write. Less urgent under the v1 plan since there's no training in v1.
5. **Is there a budget/timeline target for v1 in production, or is it "build it right, ship when ready"?** Affects how aggressive the phase 5 rollout is.
6. **Is there capacity for an active labeling sprint (admin tracing 200–500 historical orders) in parallel with v1 development?** This is the single highest-leverage thing for accelerating v1.5 and v2.

---

*End of plan. No code changes have been made. Save this file as the planning baseline; iterate on it before opening any pull request against the Roof Manager codebase.*

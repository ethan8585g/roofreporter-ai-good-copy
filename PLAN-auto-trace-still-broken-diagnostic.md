# Plan prompt — Auto-trace still wrong: diagnostic + path-specific fixes

> Copy/paste this whole file into your terminal Claude Code session. Self-contained — the terminal agent doesn't see this conversation.

## Visual evidence (what the screenshot showed)

Super-admin tracing tool for **RM-20260514-1882 — 118 Grove St, Winnipeg, MB R2W 3K8**. Auto-Trace Eaves was run. The Mapbox satellite pane shows:

- A blue polygon labeled **S1** with approximately **25+ vertices** crammed into tight micro-jogs along visible roof edges.
- Polygon footprint reads **"Sections: 1 · 1,057 ft² projected"** at the bottom-left.
- The polygon is offset DOWN and slightly LEFT of the magenta target pin (pin sits roughly on a roof peak; polygon hangs below the pin into what may be a yard / driveway boundary).
- The 3D Reference pane (Google Photorealistic) shows the property pin landing on a single house with a complex multi-gabled roof, surrounded by neighbouring townhomes.
- Street View shows 118 Grove St is the BEIGE half of a side-by-side duplex; 116 is the BLUE half.

**Diagnosis hypotheses, ranked by likelihood:**

1. **Most likely — OSM prior-promotion path returned a noisy polygon.** The vertex count (~25 micro-jogs) and the precise outline behavior (zigzagging along but slightly inset from real roof edges) is the signature of an **OpenStreetMap crowd-traced building footprint**, not a vision-model output. The agent's `pickPromotablePrior()` gate at `src/services/auto-trace-agent.ts:374` accepts OSM polygons when they contain the pin and pass the area band — but it has NO upper vertex cap, NO simplification, and NO model-corroboration step. Combined with the +0.45m outward eave buffer (`bufferRingOutwardMeters` adds yet more vertex noise on each input vertex), a sloppy OSM tracing for 118 Grove St could exactly produce this output.

2. **Possible — Model fell through to a degraded path.** If the model name `claude-opus-4-7` returned a 404 and the agent has any silent fallback (cache hit, prior-promotion, empty `segments[]` with `confidence=0`), the operator may be seeing a stale cached polygon that was once produced when a different model was wired up. The cache key is `(lat_key, lng_key, edge)` so 118 Grove St could have been traced before, persisted, and is now being served back regardless of what's wrong with the model.

3. **Unlikely but possible — Pin is on the wrong building.** Mapbox / Google geocoding of "118 Grove St, Winnipeg, MB R2W 3K8" landed on the neighbour's roof. The model traced what was under the magenta reticle (the wrong building). I can rule this OUT because the 3D Reference pane shows the pin DOES sit on a building, and the OSM polygon almost matches the rough roof outline — the polygon is just too noisy. But verify by checking `framing.lat` / `framing.lng` vs `input.lat` / `input.lng` in diagnostics.

## Step 1 — Reproduce with diagnostics ON

Before changing any code, run the failing order through the debug-mode endpoint to capture the truth.

```bash
# Get an admin JWT cookie value first (login at /super-admin, copy from devtools)
ADMIN_JWT='<paste-jwt-here>'

# Replay the exact request the UI fires, but with ?debug=1 so the response includes the satellite image
curl -X POST \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"lat": null, "lng": null, "zoom": 20, "imageWidth": 640, "imageHeight": 640}' \
  'https://www.roofmanager.ca/api/admin/superadmin/orders/<ORDER_ID>/auto-trace/eaves?debug=1' \
  | tee /tmp/at-debug.json | jq '{run_id, confidence, segments_count: (.segments|length), polygon_source: .diagnostics.polygon_source, model: .diagnostics.model, skipped_model_call: .diagnostics.skipped_model_call, cache_hit: .diagnostics.cache_hit, footprint_priors: .diagnostics.footprint_priors, planeCountDrift: .diagnostics.plane_count_drift, footprintAreaRatio: .diagnostics.footprint_area_ratio, refinement_pass: .diagnostics.refinement_pass}'
```

(Replace `<ORDER_ID>` with the actual order_id from your DB — look up `WHERE order_number = 'RM-20260514-1882'`.)

The single most important field in the response is `diagnostics.polygon_source`. The fix is path-specific.

### If `polygon_source: 'osm-overpass'`

This is hypothesis #1. The agent skipped the model and returned an OSM polygon. Continue to Step 2A.

### If `polygon_source: 'edmonton-municipal-lidar'`

Edmonton LiDAR served a polygon for a Winnipeg address — that should be impossible. There's a bbox-matching bug. Open `src/services/footprint-priors.ts` (search for `fetchFootprintPriors`) and confirm the Edmonton dataset is geographically gated (the dataset only covers Edmonton; if it returns matches outside Edmonton, the gate is broken).

### If `polygon_source: 'model'` and `cache_hit: true`

The model output was cached. Continue to Step 2B.

### If `polygon_source: 'model'` and `cache_hit: false` (or absent)

The model actually ran and produced this junk. Either the model fix worked but the output is still bad (prompt / image / projection issue), or the model name is wrong and we're hitting some fallback. Continue to Step 2C.

### If `diagnostics.model: 'none (prior-source)'` and `skipped_model_call: true`

Same as `osm-overpass`. Step 2A.

### If `diagnostics` is missing entirely

The response shape is broken. Check the route handler error path. Bigger issue than the polygon — Step 2D.

## Step 2A — Fix the OSM prior-promotion path

If OSM is the source, three issues compound:

1. **OSM polygons in Winnipeg residential areas are crowd-traced and noisy.** They commonly have 15–40 vertices for a simple gable roof because the tracer didn't simplify.
2. **The agent applies `bufferRingOutwardMeters(ring, 0.45)`** which expands each vertex outward by 0.45m using a per-edge mitre — preserving the noisy vertex count and exaggerating jogs.
3. **No model corroboration.** The agent treats OSM as ground truth and skips the vision pass entirely.

### Fixes (apply all four)

1. **Add a vertex-cap + Douglas-Peucker simplification before returning.** In `pickPromotablePrior` (or the post-promotion code in `runAutoTrace`), simplify the ring with a tolerance based on the building's edge length. Target output: 6–16 vertices for residential.

   Search for `bufferRingOutwardMeters` in `src/services/auto-trace-agent.ts:1654`. Wrap the result:

   ```ts
   import { simplifyRing } from '../utils/geo-math'  // add helper if missing
   const buffered = bufferRingOutwardMeters(promoted.ring, 0.45)
   // OSM crowd-traced polygons routinely have 25-40 vertices for a 4-corner gable.
   // Simplify to a 0.4m tolerance — preserves real corners (typical residential
   // corner-to-corner ≥ 3m), kills micro-jitter that doesn't represent a real
   // eave inflection.
   const simplified = simplifyRing(buffered, 0.4)
   // Hard upper cap: even after simplification, a residential building should
   // not need more than 20 vertices. If it does, the polygon is probably
   // covering a townhouse strip and the operator should manually trace.
   if (simplified.length > 20) {
     // Bail out of the prior-promotion path entirely — let the model handle it.
     console.warn(`[auto-trace] OSM polygon for ${input.lat},${input.lng} too noisy (${simplified.length} verts after simplify) — falling back to model`)
   } else {
     // ... return the simplified polygon
   }
   ```

   Add a `simplifyRing(ring, toleranceMeters)` helper that implements Douglas-Peucker on lat/lng with meter-based tolerance. Alternatively use Turf.js (`@turf/simplify`) but check if it's already in dependencies before adding.

2. **Require model corroboration for OSM polygons.** Edmonton municipal LiDAR is good ground truth; OSM is not. Change the gate so:
   - Edmonton polygons can skip the model (high confidence, ground truth, skip is fine).
   - OSM polygons MUST be cross-checked against a model call. Run the model in parallel with the prior fetch; if the model's IoU with the OSM polygon is ≥ 0.7, return the OSM polygon (cleaner). If IoU < 0.7, return the model's polygon (OSM is wrong for this lot). If both fail, fall through to manual trace.

3. **Drop the +0.45m outward eave buffer for OSM specifically.** The buffer is correct for Edmonton municipal LiDAR (which traces the wall outline) but OSM often already traces the eave / drip line, so adding another 0.45m double-buffers. Make the buffer source-aware:

   ```ts
   const bufferM = promoted.source === 'edmonton' ? 0.45 : 0.0
   const buffered = bufferM > 0 ? bufferRingOutwardMeters(promoted.ring, bufferM) : promoted.ring
   ```

4. **Tighten the area-band gate.** Currently `300–15,000 sqft`. For Winnipeg single-family residential (postal codes starting `R2` `R3`), the typical band is `700–3,500 sqft` for a single-family detached. The 1,057 sqft here is plausible but a 15,000 sqft OSM "building" that covers a townhouse strip would pass the current gate. Either tighten the upper bound to ~6,000 sqft for `pickPromotablePrior` OR add a "OSM area must be within 0.7×–1.4× of Solar bbox" cross-check.

## Step 2B — Cache hit on a stale model output

The model fix worked in prod, but the cache is serving a polygon from a pre-fix run.

```bash
# Purge cached model results for this lat/lng
npx wrangler d1 execute roofing-production --remote \
  --command "DELETE FROM auto_trace_cache WHERE polygon_source = 'model' OR polygon_source IS NULL;"
```

Then re-run the trace and confirm `cache_hit: false`. Already in the prior auto-trace plan — promote it from "recommended" to "required."

## Step 2C — Model is running and producing junk

If the model name fix landed and Claude is genuinely returning a 25-vertex polygon for a 4-corner duplex, the prompt is letting it. Three likely subcauses:

1. **The system prompt allows up to 32 vertices** for "multi-wing acreages" (search `20–32 vertices` in `auto-trace-agent.ts:1275`). A simple Winnipeg duplex doesn't need that — the model is taking the high end of the allowed range. Add a complexity-aware vertex cap:
   - If Solar reports `segments_count ≤ 2`, the model should emit ≤ 12 vertices.
   - If `segments_count ≥ 5`, allow up to 32.
   - Bake this into the prompt as a hard ceiling tied to the actual building's measured complexity.

2. **The model is being fed both Solar overlay + magenta target pin + hint region + DSM hillshade + wide-context + 3D viewport** — at default settings all of those are active. For a simple Winnipeg duplex, that's a lot of conflicting signals. Try toggling overlays off via the request body (`solar_segment_overlay: false`, no hint, no 3D viewport) and see if the polygon cleans up. If yes, the overlays are confusing the model on simple cases — restrict them to complex cases (Solar segments ≥ 3).

3. **The `actualImageDim` rescale** at `auto-trace-agent.ts:852` may be applying when it shouldn't. If `upscaleTo1568` is unintentionally on, coords come back in the 1568 frame and get rescaled to the 1280 projection grid — but if the rescale logic has a sign error or off-by-one, the polygon ends up shifted. Diff `actualImageDim` vs `imagePxW` in the diagnostics. If they're unequal but `upscaleTo1568` wasn't requested, that's the bug.

## Step 2D — Diagnostics field missing entirely

The route silently caught an error and returned a partial response. Open `src/routes/admin.ts:5333` and add a structured error response that surfaces the actual exception class + message to the operator (still gated behind super-admin only — no info leak).

## Step 3 — Add a polygon sanity gate to the UI (defense in depth)

Whatever path produced the bad polygon, the UI accepted it silently. Add a sanity gate to `saAutoTrace` in `public/static/super-admin-dashboard.js:4558` that flags obviously-bad polygons before injecting them onto the map:

```js
// Sanity checks BEFORE injecting onto the map. The agent isn't always
// right; surface the failure to the operator instead of drawing a bad
// polygon that they then have to clean up.
function saValidateAutoTraceResult(edge, data) {
  const issues = [];
  if (edge === 'eaves') {
    for (const poly of (data.segments || [])) {
      if (poly.length > 20) issues.push(`Polygon has ${poly.length} vertices — looks like crowd-traced OSM noise`);
      if (poly.length < 4) issues.push(`Polygon has only ${poly.length} vertices — too few for a building`);
    }
    // Footprint ratio: if Solar says ~2200 sqft and agent returns 1057, that's 0.48x — flag.
    const ratio = data.diagnostics?.footprint_area_ratio;
    if (typeof ratio === 'number' && (ratio < 0.6 || ratio > 1.6)) {
      issues.push(`Traced area is ${Math.round(ratio*100)}% of Solar's bbox — likely tracing wrong building or missing wings`);
    }
  }
  return issues;
}

// In saAutoTrace, after parsing response but before saInjectAutoEaves:
const issues = saValidateAutoTraceResult(edge, data);
if (issues.length > 0) {
  const ok = confirm(`Auto-trace returned a suspicious result:\n\n• ${issues.join('\n• ')}\n\nInject anyway?`);
  if (!ok) return;
}
```

## Step 4 — Add per-order diagnostic panel for the preview page

The new "Generate Report Preview" page (from the prior plan) should expose `diagnostics` so the super-admin can see, for each auto-trace run on the order's history:
- `polygon_source`
- `confidence`
- `model`
- `cache_hit`
- `refinement_pass`
- `plane_count_drift`
- `footprint_area_ratio`
- `vertex counts per segment`

Surface these in a collapsible "Agent diagnostics" section on the preview page so the operator sees WHY a trace looks wrong without having to curl the API. Today the only place this data lives is the `user_activity_log` table.

## Step 5 — Verify the original model-name fix is actually live

If the prior plan was deployed, confirm:

```bash
grep -rn "claude-opus-4-7" src/ public/static/
```

Should return 0 hits. If it still has hits, the model fix wasn't applied — go back to that plan.

```bash
# Tail the worker logs while pressing Auto-Trace Eaves on order RM-20260514-1882
npx wrangler pages deployment tail --project-name roofing-measurement-tool | grep -iE "auto-trace|model_not_found|opus|sonnet"
```

If you see `model_not_found` in the logs, the model fix is missing or got reverted.

## Step 6 — Specific test for 118 Grove St, Winnipeg

Once the path-specific fix is in, retest with this exact case. Expected outcome:

- Polygon: a clean 4-8 vertex rectangle covering ONE half of the duplex (118, not 116).
- Footprint: ~700–1,400 ft² projected (a single duplex unit, two storeys).
- Confidence: ≥ 70% (simple residential shape).
- `polygon_source`: either `model` (with low vertex count) or `osm-overpass` (with simplification applied).
- `footprint_area_ratio` close to 1.0 (agent area matches Solar bbox).

Capture the `before-fix` and `after-fix` JSON responses side-by-side to confirm the fix works.

## Deliverables checklist

- [ ] Step 1 reproduced with `?debug=1`, JSON captured to `/tmp/at-debug.json`
- [ ] Identified which code path produced the bad polygon (`polygon_source`)
- [ ] Path-specific fix from Step 2A / 2B / 2C / 2D applied
- [ ] OSM polygon simplification helper added (`simplifyRing`)
- [ ] Source-aware eave buffer (0.45m for Edmonton, 0m for OSM)
- [ ] Vertex cap + sanity gate in `saAutoTrace` (Step 3)
- [ ] Diagnostics surfaced on the new Report Preview page (Step 4)
- [ ] Cache purged again post-fix (`auto_trace_cache` model rows)
- [ ] 118 Grove St retest: polygon ≤ 8 vertices, footprint 700–1,400 ft²
- [ ] Harness re-run on 10 known-good orders: IoU mean > 0.8
- [ ] `npm run build` + `npx vitest run` green

## Rules for the implementing agent

- **Run Step 1 FIRST.** Don't guess which path is broken — the `polygon_source` field tells you definitively in 60 seconds. Every minute spent rebuilding the wrong path is wasted.
- **Don't delete OSM prior-promotion entirely.** When it works (clean OSM polygon, single building) it's instant + free + grounded in real-world data. The fix is simplification + corroboration, not removal.
- **If `polygon_source: 'model'` with this output, the prompt needs the most work — the model is overshooting vertex counts.** Adding a hard cap tied to Solar segment count is the highest-leverage prompt change.
- **The UI sanity gate from Step 3 should ship regardless of which path was broken.** It's defense in depth — catches future regressions before they cost the operator manual-cleanup time.
- **Don't skip the cache purge.** A model + prompt fix that ships without purging cache will look identical to broken on every previously-traced lot.
- `npm run build` and `vitest` must be green before deploy. Don't deploy until the 118 Grove St retest passes.

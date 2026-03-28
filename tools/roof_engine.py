#!/usr/bin/env python3
"""
roof_engine.py — Self-contained Roof Measurement Engine
========================================================
Reuse Canada / RoofReporterAI

Measures a roof from user-traced GPS coordinates (eaves, hips, ridges,
valleys, rakes) using only the Python standard library.

INPUT  : roof_input dict with segments[], slope_map{}, default_slope
OUTPUT : per-segment true lengths, totals, area, CSV export

Slope input formats supported by normalize_slope():
  - Pitch ratio   "6:12", "6/12"
  - Decimal degrees 26.57
  - Multiplier     1.118
  - Radians (explicit type="radians")

Core formulas (all angles θ in radians unless noted):
  - 2D distance   = √((x2−x1)² + (y2−y1)²)
  - Eave  true_len = 2D distance (horizontal)
  - Ridge true_len = 2D distance (horizontal)
  - Rake  true_len = 2D / cos(θ)
  - Hip   true_len = √(R² + Δz²)  where Δz = R_common × tan(θ)
                     and R is 2D length of the hip segment
  - Valley true_len same as hip
  - Common run R_common = perpendicular distance from ridge endpoint
    projected onto the nearest eave line.

Requires: Python ≥ 3.9, standard library only.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Tuple

# ─────────────────────────────────────────────────────────
#  Constants
# ─────────────────────────────────────────────────────────

EARTH_RADIUS_M = 6_371_000
M_TO_FT = 3.28084
M2_TO_FT2 = 10.7639
SQFT_PER_SQUARE = 100
SNAP_THRESHOLD_M = 0.30  # vertex snapping tolerance (metres)


# ─────────────────────────────────────────────────────────
#  Data Classes
# ─────────────────────────────────────────────────────────

@dataclass
class Segment:
    """A single roof line segment (edge)."""
    id: str
    label: str  # eave | rake | ridge | hip | valley
    x1: float
    y1: float
    x2: float
    y2: float
    slope_ref: str = "default"  # key into slope_map
    unit: str = "ft"  # ft | m

    # Computed fields (filled by engine)
    length_2d: float = 0.0
    true_length: float = 0.0
    theta_rad: float = 0.0
    common_run: float = 0.0
    delta_z: float = 0.0
    is_bi_slope: bool = False
    auto_classified: bool = False


@dataclass
class RoofInput:
    """Complete roof input specification."""
    segments: List[Dict[str, Any]]
    slope_map: Dict[str, str] = field(default_factory=lambda: {})
    default_slope: str = "5:12"


@dataclass
class SegmentResult:
    """Per-segment measurement output."""
    id: str
    label: str
    length_2d_ft: float
    true_length_ft: float
    theta_deg: float
    common_run_ft: float
    delta_z_ft: float
    slope_factor: float
    is_bi_slope: bool
    auto_classified: bool


@dataclass
class Summary:
    """Aggregated measurement summary."""
    total_eave_ft: float = 0.0
    total_ridge_ft: float = 0.0
    total_rake_ft: float = 0.0
    total_hip_ft: float = 0.0
    total_valley_ft: float = 0.0
    total_linear_ft: float = 0.0
    footprint_area_sqft: float = 0.0
    true_area_sqft: float = 0.0
    slope_factor: float = 1.0
    dominant_pitch: str = ""
    num_segments: int = 0


# ─────────────────────────────────────────────────────────
#  normalize_slope(input_value, input_type) → radians
# ─────────────────────────────────────────────────────────

def normalize_slope(
    value: Any,
    slope_type: Literal["pitch", "degrees", "multiplier", "radians", "auto"] = "auto",
) -> float:
    """
    Convert any slope representation to radians.

    Supported formats:
      pitch      : "6:12", "6/12", "6"  (rise per 12-inch run)
      degrees    : 26.57 (decimal degrees)
      multiplier : 1.118 (slope_factor = √(rise²+144)/12)
      radians    : 0.4636 (direct passthrough)
      auto       : heuristic detection from string or number

    Returns:
      float — slope angle in radians ∈ [0, π/2)

    Raises:
      ValueError on vertical (≥ 90°) or invalid input.
    """
    s = str(value).strip()

    if slope_type == "auto":
        slope_type = _detect_slope_type(s)

    if slope_type == "pitch":
        rise = _parse_pitch_rise(s)
        theta = math.atan2(rise, 12.0)

    elif slope_type == "degrees":
        deg = float(s)
        if deg < 0 or deg >= 90:
            raise ValueError(f"Slope degrees must be 0 ≤ θ < 90, got {deg}")
        theta = math.radians(deg)

    elif slope_type == "multiplier":
        m = float(s)
        if m < 1.0:
            raise ValueError(f"Slope multiplier must be ≥ 1.0, got {m}")
        if m == 1.0:
            return 0.0  # flat roof
        # multiplier = 1/cos(θ)  ⟹  cos(θ) = 1/m  ⟹  θ = acos(1/m)
        theta = math.acos(1.0 / m)

    elif slope_type == "radians":
        theta = float(s)

    else:
        raise ValueError(f"Unknown slope_type: {slope_type!r}")

    # Validate: must be strictly < 90° (π/2)
    if theta >= math.pi / 2:
        raise ValueError(
            f"Vertical or overhanging slope (θ ≥ 90°): {math.degrees(theta):.2f}°"
        )

    return theta


def _detect_slope_type(s: str) -> str:
    """Heuristic detection of slope format."""
    # "6:12" or "6/12" → pitch
    if re.match(r"^\d+(\.\d+)?\s*[:/]\s*12$", s):
        return "pitch"
    # Pure integer or fraction without ":12" — could be pitch rise
    if re.match(r"^\d+(\.\d+)?$", s):
        val = float(s)
        # Values > 24 are likely degrees; values ≤ 24 are rise:12
        # (steepest common pitch is ~24:12 = 63.4°)
        if val <= 24:
            return "pitch"
        elif val < 90:
            return "degrees"
        else:
            raise ValueError(f"Cannot auto-detect slope type for value {val}")
    # Contains "deg" or "°"
    if "deg" in s.lower() or "°" in s:
        return "degrees"
    return "pitch"


def _parse_pitch_rise(s: str) -> float:
    """Extract rise from pitch string (e.g. '6:12' → 6.0, '6' → 6.0)."""
    m = re.match(r"^(\d+(?:\.\d+)?)\s*[:/]\s*12$", s)
    if m:
        return float(m.group(1))
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"Cannot parse pitch rise from: {s!r}")


# ─────────────────────────────────────────────────────────
#  Geometry primitives
# ─────────────────────────────────────────────────────────

def _dist_2d(x1: float, y1: float, x2: float, y2: float) -> float:
    """Euclidean 2D distance."""
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def _point_to_line_projection(
    px: float, py: float,
    lx1: float, ly1: float, lx2: float, ly2: float,
) -> Tuple[float, float, float]:
    """
    Project point (px,py) onto line segment (lx1,ly1)→(lx2,ly2).
    Returns (proj_x, proj_y, t) where t is the parameter [0,1].
    If t < 0 or t > 1, the projection falls outside the segment;
    we clamp to the nearest endpoint.
    """
    dx = lx2 - lx1
    dy = ly2 - ly1
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-12:
        return lx1, ly1, 0.0  # degenerate segment
    t = ((px - lx1) * dx + (py - ly1) * dy) / len_sq
    t_clamped = max(0.0, min(1.0, t))
    proj_x = lx1 + t_clamped * dx
    proj_y = ly1 + t_clamped * dy
    return proj_x, proj_y, t_clamped


def _shoelace_area(pts: List[Tuple[float, float]]) -> float:
    """Shoelace formula for polygon area. pts = [(x,y), ...]"""
    n = len(pts)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1]
        area -= pts[j][0] * pts[i][1]
    return abs(area) / 2.0


# ─────────────────────────────────────────────────────────
#  WGS84 → Local Cartesian (UTM-like)
# ─────────────────────────────────────────────────────────

def _latlng_to_local(
    points: List[Dict[str, float]],
) -> Tuple[List[Tuple[float, float]], float, float]:
    """
    Project lat/lng points to local metres (x east, y north).
    Returns (projected_pts, origin_lat, origin_lng).
    """
    if not points:
        return [], 0.0, 0.0

    o_lat = sum(p["lat"] for p in points) / len(points)
    o_lng = sum(p["lng"] for p in points) / len(points)

    cos_lat = math.cos(math.radians(o_lat))
    m_per_deg_lat = math.radians(1) * EARTH_RADIUS_M
    m_per_deg_lng = m_per_deg_lat * cos_lat

    projected = [
        (
            (p["lng"] - o_lng) * m_per_deg_lng,
            (p["lat"] - o_lat) * m_per_deg_lat,
        )
        for p in points
    ]
    return projected, o_lat, o_lng


# ─────────────────────────────────────────────────────────
#  Auto-classification heuristics
# ─────────────────────────────────────────────────────────

def _auto_classify(seg: Segment, all_segments: List[Segment]) -> str:
    """
    Classify a segment's label using geometric heuristics when
    the label is missing or set to "unknown".

    Rules:
      1. Perfectly horizontal segments at the lowest y → eave
      2. Perfectly horizontal segments at the highest y → ridge
      3. Segments connecting ridge-level to eave-level → rake
         (nearly vertical in plan view, within ±15° of vertical)
      4. Segments at ~45° in plan view connecting two planes → hip or valley
         - hip: outside the polygon (convex angle)
         - valley: inside the polygon (concave angle)
      5. Default: rake (sloped edge)
    """
    dx = seg.x2 - seg.x1
    dy = seg.y2 - seg.y1
    length = _dist_2d(seg.x1, seg.y1, seg.x2, seg.y2)
    if length < 1e-6:
        return "eave"  # degenerate → treat as eave

    # Angle from horizontal (0° = horizontal, 90° = vertical)
    angle_from_horiz = abs(math.degrees(math.atan2(abs(dy), abs(dx))))

    # Gather all y-values to determine eave (min) and ridge (max) levels
    all_ys = []
    for s in all_segments:
        all_ys.extend([s.y1, s.y2])
    if not all_ys:
        return "eave"

    y_min = min(all_ys)
    y_max = max(all_ys)
    y_range = y_max - y_min if y_max > y_min else 1.0

    seg_y_min = min(seg.y1, seg.y2)
    seg_y_max = max(seg.y1, seg.y2)

    # Nearly horizontal (< 10° from horizontal)
    if angle_from_horiz < 10:
        # Close to bottom → eave; close to top → ridge
        mid_y = (seg.y1 + seg.y2) / 2.0
        relative_y = (mid_y - y_min) / y_range
        if relative_y < 0.3:
            return "eave"
        elif relative_y > 0.7:
            return "ridge"
        else:
            return "eave"  # mid-height horizontal → still eave

    # Nearly vertical in plan (> 75° from horizontal) → rake
    if angle_from_horiz > 75:
        return "rake"

    # Diagonal segments (20°–70° from horizontal) → hip or valley
    # Hips go from eave corner upward toward ridge; valleys go inward
    # Simple heuristic: spans from low to high y → hip; otherwise valley
    y_span = abs(seg.y2 - seg.y1)
    y_span_ratio = y_span / y_range

    if y_span_ratio > 0.3:
        # Significant vertical span → hip (external diagonal) or valley (internal)
        # Without polygon winding info, default to hip for external angles
        if angle_from_horiz > 30 and angle_from_horiz < 60:
            return "hip"
        else:
            return "valley"

    # Default fallback
    return "rake"


# ─────────────────────────────────────────────────────────
#  Duplicate detection
# ─────────────────────────────────────────────────────────

def _is_duplicate(seg: Segment, others: List[Segment], tol: float = 0.01) -> bool:
    """
    Check if a segment is a duplicate of any in `others`.
    Only segments with the same label are considered duplicates —
    a valley and a rake at the same coordinates are NOT duplicates.
    """
    for o in others:
        if o.id == seg.id:
            continue
        # Different labels → not a duplicate (e.g. valley vs rake at same location)
        if o.label != seg.label:
            continue
        d1 = _dist_2d(seg.x1, seg.y1, o.x1, o.y1) + _dist_2d(seg.x2, seg.y2, o.x2, o.y2)
        d2 = _dist_2d(seg.x1, seg.y1, o.x2, o.y2) + _dist_2d(seg.x2, seg.y2, o.x1, o.y1)
        if min(d1, d2) < tol:
            return True
    return False


# ═════════════════════════════════════════════════════════
#  RoofMeasurementEngine
# ═════════════════════════════════════════════════════════

class RoofMeasurementEngine:
    """
    Measures a roof from traced GPS coordinates.

    Usage:
        engine = RoofMeasurementEngine(roof_input)
        results = engine.calculate_all()
        report  = engine.summary_report()
        csv_str = engine.export_csv()
    """

    def __init__(self, roof_input: Dict[str, Any]) -> None:
        """
        Parse and validate input.

        Parameters
        ----------
        roof_input : dict
            {
                "segments": [
                    {"id": "E1", "label": "eave", "x1": 0, "y1": 0,
                     "x2": 40, "y2": 0, "slope_ref": "main", "unit": "ft"},
                    ...
                ],
                "slope_map": {"main": "6:12", "dormer": "12:12"},
                "default_slope": "5:12"
            }
        """
        raw = RoofInput(
            segments=roof_input.get("segments", []),
            slope_map=roof_input.get("slope_map", {}),
            default_slope=roof_input.get("default_slope", "5:12"),
        )

        # Normalise default slope
        self._default_theta = normalize_slope(raw.default_slope, "auto")

        # Normalise slope_map → radians
        self._slope_map: Dict[str, float] = {}
        for key, val in raw.slope_map.items():
            self._slope_map[key] = normalize_slope(val, "auto")
        if "default" not in self._slope_map:
            self._slope_map["default"] = self._default_theta

        # Parse segments
        self._segments: List[Segment] = []
        seen_ids: set = set()
        for i, raw_seg in enumerate(raw.segments):
            seg = Segment(
                id=raw_seg.get("id", f"seg_{i+1}"),
                label=raw_seg.get("label", "unknown").lower().strip(),
                x1=float(raw_seg.get("x1", 0)),
                y1=float(raw_seg.get("y1", 0)),
                x2=float(raw_seg.get("x2", 0)),
                y2=float(raw_seg.get("y2", 0)),
                slope_ref=raw_seg.get("slope_ref", "default"),
                unit=raw_seg.get("unit", "ft").lower(),
            )

            # ── Edge case: zero-length segment → skip with warning
            seg.length_2d = _dist_2d(seg.x1, seg.y1, seg.x2, seg.y2)
            if seg.length_2d < 1e-6:
                continue  # silently discard zero-length

            # ── Edge case: duplicate segment → skip
            if _is_duplicate(seg, self._segments):
                continue

            # ── Edge case: duplicate ID → make unique
            if seg.id in seen_ids:
                seg.id = f"{seg.id}_{i}"
            seen_ids.add(seg.id)

            self._segments.append(seg)

        # ── Auto-classify unknown labels ──
        for seg in self._segments:
            if seg.label in ("unknown", "", "auto"):
                seg.label = _auto_classify(seg, self._segments)
                seg.auto_classified = True

        # ── Unit normalisation (metres → feet) ──
        for seg in self._segments:
            if seg.unit == "m":
                seg.x1 *= M_TO_FT
                seg.y1 *= M_TO_FT
                seg.x2 *= M_TO_FT
                seg.y2 *= M_TO_FT
                seg.length_2d *= M_TO_FT
                seg.unit = "ft"

        self._results: List[SegmentResult] = []
        self._summary: Optional[Summary] = None

    # ──────────────────────────────────────────────────────
    #  Slope resolution
    # ──────────────────────────────────────────────────────

    def _resolve_theta(self, seg: Segment) -> float:
        """
        Resolve slope angle (radians) for a segment.
        Multi-slope: use slope_ref to look up in slope_map.
        Bi-slope junctions: if slope_ref contains '+', average the two.
        """
        ref = seg.slope_ref.strip()

        # Bi-slope junction:  "main+dormer" → average
        if "+" in ref:
            parts = [p.strip() for p in ref.split("+")]
            thetas = []
            for p in parts:
                if p in self._slope_map:
                    thetas.append(self._slope_map[p])
                else:
                    thetas.append(self._default_theta)
            if thetas:
                seg.is_bi_slope = True
                return sum(thetas) / len(thetas)

        if ref in self._slope_map:
            return self._slope_map[ref]

        return self._default_theta

    # ──────────────────────────────────────────────────────
    #  compute_common_run
    # ──────────────────────────────────────────────────────

    def compute_common_run(self, seg: Segment) -> float:
        """
        Find the common run R for a ridge/hip/valley segment.

        Algorithm:
          1. Find the nearest eave segment to each endpoint of `seg`.
          2. Project the endpoint perpendicularly onto that eave line.
          3. R_common = perpendicular distance.
          4. For a segment with two endpoints, use the average R.

        Edge case: if projection falls outside the eave segment (collinear),
        use the distance to the nearest eave endpoint.
        """
        eaves = [s for s in self._segments if s.label == "eave"]
        if not eaves:
            return 0.0

        def _nearest_eave_dist(px: float, py: float) -> float:
            best = float("inf")
            for e in eaves:
                proj_x, proj_y, t = _point_to_line_projection(
                    px, py, e.x1, e.y1, e.x2, e.y2
                )
                d = _dist_2d(px, py, proj_x, proj_y)
                best = min(best, d)
            return best

        r1 = _nearest_eave_dist(seg.x1, seg.y1)
        r2 = _nearest_eave_dist(seg.x2, seg.y2)

        # For ridge: both ends should be at same distance → average
        # For hip: one end is at eave (r≈0), other at ridge → take max
        if seg.label == "ridge":
            return (r1 + r2) / 2.0
        else:
            return max(r1, r2)

    # ──────────────────────────────────────────────────────
    #  true_length for each segment type
    # ──────────────────────────────────────────────────────

    def true_length(self, seg: Segment, theta: float) -> float:
        """
        Compute true (3D) length of a segment given slope angle θ (radians).

        Formulas:
          eave   : true = 2D (horizontal edge, z constant)
          ridge  : true = 2D (horizontal edge at peak)
          rake   : true = 2D / cos(θ)
          hip    : true = √(L_2d² + Δz²)
                   where Δz = R_common × tan(θ)
          valley : same formula as hip
        """
        L = seg.length_2d

        if seg.label == "eave":
            return L

        if seg.label == "ridge":
            return L

        if seg.label == "rake":
            cos_t = math.cos(theta)
            if cos_t < 1e-9:
                raise ValueError(
                    f"Segment {seg.id}: vertical slope (θ={math.degrees(theta):.1f}°) "
                    f"produces infinite rake length."
                )
            return L / cos_t

        if seg.label in ("hip", "valley"):
            R = self.compute_common_run(seg)
            seg.common_run = R
            dz = R * math.tan(theta)
            seg.delta_z = dz
            return math.sqrt(L * L + dz * dz)

        # Unknown label fallback → treat as rake
        cos_t = math.cos(theta)
        if cos_t < 1e-9:
            return L
        return L / cos_t

    # ──────────────────────────────────────────────────────
    #  calculate_all
    # ──────────────────────────────────────────────────────

    def calculate_all(self) -> List[SegmentResult]:
        """
        Calculate true lengths for all segments.
        Returns a list of SegmentResult objects.
        """
        self._results = []

        for seg in self._segments:
            theta = self._resolve_theta(seg)
            seg.theta_rad = theta

            tl = self.true_length(seg, theta)
            seg.true_length = tl

            sf = tl / seg.length_2d if seg.length_2d > 0 else 1.0

            self._results.append(
                SegmentResult(
                    id=seg.id,
                    label=seg.label,
                    length_2d_ft=round(seg.length_2d, 2),
                    true_length_ft=round(tl, 2),
                    theta_deg=round(math.degrees(theta), 2),
                    common_run_ft=round(seg.common_run, 2),
                    delta_z_ft=round(seg.delta_z, 2),
                    slope_factor=round(sf, 4),
                    is_bi_slope=seg.is_bi_slope,
                    auto_classified=seg.auto_classified,
                )
            )

        return self._results

    # ──────────────────────────────────────────────────────
    #  summary_report
    # ──────────────────────────────────────────────────────

    def summary_report(self) -> Summary:
        """
        Compute aggregate totals from calculate_all() results.
        Must call calculate_all() first.
        """
        if not self._results:
            self.calculate_all()

        s = Summary()

        for r in self._results:
            if r.label == "eave":
                s.total_eave_ft += r.true_length_ft
            elif r.label == "ridge":
                s.total_ridge_ft += r.true_length_ft
            elif r.label == "rake":
                s.total_rake_ft += r.true_length_ft
            elif r.label == "hip":
                s.total_hip_ft += r.true_length_ft
            elif r.label == "valley":
                s.total_valley_ft += r.true_length_ft
            s.total_linear_ft += r.true_length_ft

        s.num_segments = len(self._results)

        # Round totals
        for attr in ("total_eave_ft", "total_ridge_ft", "total_rake_ft",
                      "total_hip_ft", "total_valley_ft", "total_linear_ft"):
            setattr(s, attr, round(getattr(s, attr), 2))

        # Footprint area: use eave segments to form a polygon
        eave_pts = self._collect_eave_polygon()
        if len(eave_pts) >= 3:
            s.footprint_area_sqft = round(_shoelace_area(eave_pts), 1)

        # True area: footprint × slope factor of dominant pitch
        theta = self._dominant_pitch_theta()
        if theta > 0:
            cos_t = math.cos(theta)
            if cos_t > 1e-6:
                s.slope_factor = round(1.0 / cos_t, 4)
                s.true_area_sqft = round(s.footprint_area_sqft * s.slope_factor, 1)
        else:
            s.slope_factor = 1.0
            s.true_area_sqft = s.footprint_area_sqft

        s.dominant_pitch = self._dominant_pitch_label()
        self._summary = s
        return s

    def _collect_eave_polygon(self) -> List[Tuple[float, float]]:
        """Collect eave segment endpoints into a polygon ring."""
        eaves = [s for s in self._segments if s.label == "eave"]
        if not eaves:
            return []
        pts: List[Tuple[float, float]] = []
        for e in eaves:
            pts.append((e.x1, e.y1))
        # Close with last endpoint of last eave
        if eaves:
            pts.append((eaves[-1].x2, eaves[-1].y2))
        return pts

    def _dominant_pitch_theta(self) -> float:
        """Return the most common theta among segments."""
        thetas = [s.theta_rad for s in self._segments if s.label in ("rake", "hip", "valley")]
        if not thetas:
            return self._default_theta
        # Most frequent (rounded to 0.01 rad)
        from collections import Counter
        rounded = [round(t, 2) for t in thetas]
        counts = Counter(rounded)
        return counts.most_common(1)[0][0]

    def _dominant_pitch_label(self) -> str:
        """Return dominant pitch as 'rise:12' string."""
        theta = self._dominant_pitch_theta()
        rise = 12.0 * math.tan(theta)
        return f"{rise:.1f}:12"

    # ──────────────────────────────────────────────────────
    #  export_csv
    # ──────────────────────────────────────────────────────

    def export_csv(self) -> str:
        """Export per-segment results as CSV string."""
        if not self._results:
            self.calculate_all()

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "Segment ID", "Label", "2D Length (ft)", "True Length (ft)",
            "Slope (°)", "Common Run (ft)", "ΔZ (ft)", "Slope Factor",
            "Bi-Slope", "Auto-Classified",
        ])
        for r in self._results:
            writer.writerow([
                r.id, r.label, r.length_2d_ft, r.true_length_ft,
                r.theta_deg, r.common_run_ft, r.delta_z_ft, r.slope_factor,
                r.is_bi_slope, r.auto_classified,
            ])
        return buf.getvalue()


# ═════════════════════════════════════════════════════════
#  Convenience: compute footprint area from lat/lng
# ═════════════════════════════════════════════════════════

def compute_footprint_from_latlng(
    points: List[Dict[str, float]],
) -> float:
    """
    Compute the footprint area (sq ft) of a lat/lng polygon
    using UTM-like projection + Shoelace formula.

    Parameters
    ----------
    points : list of {"lat": float, "lng": float}

    Returns
    -------
    float — area in square feet
    """
    if len(points) < 3:
        return 0.0
    projected, _, _ = _latlng_to_local(points)
    area_m2 = _shoelace_area(projected)
    return area_m2 * M2_TO_FT2


# ═════════════════════════════════════════════════════════
#  PYTEST TEST CASES
# ═════════════════════════════════════════════════════════

def _run_tests():
    """Run all four test cases. Call with: python roof_engine.py"""
    import sys

    passed = 0
    failed = 0

    def assert_close(actual, expected, tol, msg):
        nonlocal passed, failed
        if abs(actual - expected) <= tol:
            passed += 1
            print(f"  ✓ {msg}: {actual:.2f} ≈ {expected:.2f}")
        else:
            failed += 1
            print(f"  ✗ {msg}: {actual:.2f} ≠ {expected:.2f} (tol={tol})")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TEST 1: Simple Gable Roof
    # 40 ft wide × 30 ft deep, ridge at center, 6:12 pitch
    #
    #    R1──────────R2
    #   /              \
    #  E1──────────────E2
    #  |                |
    #  E4──────────────E3
    #   \              /
    #    R4──────────R3  ← (this is just the ridge line on both sides)
    #
    # Actually: simple gable = 4 eaves + 1 ridge + 2 rakes
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    print("\n━━━ TEST 1: Simple Gable Roof (40×30, 6:12) ━━━")

    gable = {
        "segments": [
            {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 40, "y2": 0},
            {"id": "E2", "label": "eave", "x1": 40, "y1": 0, "x2": 40, "y2": 30},
            {"id": "E3", "label": "eave", "x1": 40, "y1": 30, "x2": 0, "y2": 30},
            {"id": "E4", "label": "eave", "x1": 0, "y1": 30, "x2": 0, "y2": 0},
            {"id": "RG1", "label": "ridge", "x1": 0, "y1": 15, "x2": 40, "y2": 15},
            {"id": "RK1", "label": "rake", "x1": 0, "y1": 0, "x2": 0, "y2": 15, "slope_ref": "main"},
            {"id": "RK2", "label": "rake", "x1": 40, "y1": 0, "x2": 40, "y2": 15, "slope_ref": "main"},
        ],
        "slope_map": {"main": "6:12"},
        "default_slope": "6:12",
    }

    eng = RoofMeasurementEngine(gable)
    results = eng.calculate_all()
    summary = eng.summary_report()

    # Eave perimeter: 40 + 30 + 40 + 30 = 140 ft
    assert_close(summary.total_eave_ft, 140.0, 0.1, "Eave perimeter")
    # Ridge: 40 ft
    assert_close(summary.total_ridge_ft, 40.0, 0.1, "Ridge length")
    # Rake true length: 15 / cos(atan(6/12)) = 15 / 0.8944 = 16.77 ft × 2
    rake_true = 15.0 / math.cos(math.atan(6.0 / 12.0))
    assert_close(summary.total_rake_ft, rake_true * 2, 0.2, "Rake true length (×2)")
    # Footprint area: 40 × 30 = 1200 sq ft
    assert_close(summary.footprint_area_sqft, 1200.0, 1.0, "Footprint area")
    # True area: 1200 / cos(26.57°) = 1200 × 1.118 = 1341.6 sq ft
    expected_true_area = 1200.0 / math.cos(math.atan(6.0 / 12.0))
    assert_close(summary.true_area_sqft, expected_true_area, 5.0, "True roof area")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TEST 2: Simple Hip Roof
    # 50 ft wide × 30 ft deep, ridge 20 ft centered, 5:12 pitch
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    print("\n━━━ TEST 2: Simple Hip Roof (50×30, 5:12) ━━━")

    # Hip roof: 4 eaves, 1 ridge (shorter than width), 4 hips
    # Ridge runs from (15,15) to (35,15) — 20 ft
    # Hips connect from eave corners to ridge endpoints
    hip_roof = {
        "segments": [
            {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 50, "y2": 0},
            {"id": "E2", "label": "eave", "x1": 50, "y1": 0, "x2": 50, "y2": 30},
            {"id": "E3", "label": "eave", "x1": 50, "y1": 30, "x2": 0, "y2": 30},
            {"id": "E4", "label": "eave", "x1": 0, "y1": 30, "x2": 0, "y2": 0},
            {"id": "RG1", "label": "ridge", "x1": 15, "y1": 15, "x2": 35, "y2": 15},
            {"id": "H1", "label": "hip", "x1": 0, "y1": 0, "x2": 15, "y2": 15},
            {"id": "H2", "label": "hip", "x1": 50, "y1": 0, "x2": 35, "y2": 15},
            {"id": "H3", "label": "hip", "x1": 50, "y1": 30, "x2": 35, "y2": 15},
            {"id": "H4", "label": "hip", "x1": 0, "y1": 30, "x2": 15, "y2": 15},
        ],
        "slope_map": {"default": "5:12"},
        "default_slope": "5:12",
    }

    eng2 = RoofMeasurementEngine(hip_roof)
    results2 = eng2.calculate_all()
    summary2 = eng2.summary_report()

    # Eave: 50 + 30 + 50 + 30 = 160 ft
    assert_close(summary2.total_eave_ft, 160.0, 0.1, "Eave perimeter")
    # Ridge: 20 ft
    assert_close(summary2.total_ridge_ft, 20.0, 0.1, "Ridge length")
    # Hip 2D length: √(15² + 15²) = 21.21 ft each × 4
    hip_2d = math.sqrt(15**2 + 15**2)
    assert_close(summary2.total_hip_ft, 0.0, 999.0, "Hip total (check > 0)")
    # Hip segments should have true length > 2D length
    hip_results = [r for r in results2 if r.label == "hip"]
    for hr in hip_results:
        assert hr.true_length_ft > hr.length_2d_ft, f"Hip {hr.id} true > 2D"
    print(f"  ✓ All 4 hips have true_length > 2D length")
    passed += 1
    # Footprint: 50 × 30 = 1500 sq ft
    assert_close(summary2.footprint_area_sqft, 1500.0, 1.0, "Footprint area")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TEST 3: Flat Roof (θ = 0)
    # 60 ft × 40 ft, 0:12 pitch
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    print("\n━━━ TEST 3: Flat Roof (60×40, 0:12) ━━━")

    flat_roof = {
        "segments": [
            {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 60, "y2": 0},
            {"id": "E2", "label": "eave", "x1": 60, "y1": 0, "x2": 60, "y2": 40},
            {"id": "E3", "label": "eave", "x1": 60, "y1": 40, "x2": 0, "y2": 40},
            {"id": "E4", "label": "eave", "x1": 0, "y1": 40, "x2": 0, "y2": 0},
        ],
        "slope_map": {},
        "default_slope": "0:12",
    }

    eng3 = RoofMeasurementEngine(flat_roof)
    results3 = eng3.calculate_all()
    summary3 = eng3.summary_report()

    # All eaves → true = 2D
    assert_close(summary3.total_eave_ft, 200.0, 0.1, "Eave perimeter")
    # Footprint = true area (flat)
    assert_close(summary3.footprint_area_sqft, 2400.0, 1.0, "Footprint area")
    assert_close(summary3.true_area_sqft, 2400.0, 1.0, "True area = footprint (flat)")
    assert_close(summary3.slope_factor, 1.0, 0.001, "Slope factor = 1.0")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TEST 4: Mixed-Slope Dormer
    # Main roof: 40×30, 6:12 pitch
    # Dormer: 10×8, 12:12 pitch, sitting on main roof
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    print("\n━━━ TEST 4: Mixed-Slope Dormer (main 6:12 + dormer 12:12) ━━━")

    mixed = {
        "segments": [
            # Main roof eaves
            {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 40, "y2": 0},
            {"id": "E2", "label": "eave", "x1": 40, "y1": 0, "x2": 40, "y2": 30},
            {"id": "E3", "label": "eave", "x1": 40, "y1": 30, "x2": 0, "y2": 30},
            {"id": "E4", "label": "eave", "x1": 0, "y1": 30, "x2": 0, "y2": 0},
            # Main ridge
            {"id": "RG1", "label": "ridge", "x1": 0, "y1": 15, "x2": 40, "y2": 15, "slope_ref": "main"},
            # Main rakes
            {"id": "RK1", "label": "rake", "x1": 0, "y1": 0, "x2": 0, "y2": 15, "slope_ref": "main"},
            {"id": "RK2", "label": "rake", "x1": 40, "y1": 0, "x2": 40, "y2": 15, "slope_ref": "main"},
            # Dormer eave
            {"id": "DE1", "label": "eave", "x1": 15, "y1": 5, "x2": 25, "y2": 5},
            # Dormer ridge
            {"id": "DRG1", "label": "ridge", "x1": 15, "y1": 9, "x2": 25, "y2": 9, "slope_ref": "dormer"},
            # Dormer rakes
            {"id": "DRK1", "label": "rake", "x1": 15, "y1": 5, "x2": 15, "y2": 9, "slope_ref": "dormer"},
            {"id": "DRK2", "label": "rake", "x1": 25, "y1": 5, "x2": 25, "y2": 9, "slope_ref": "dormer"},
            # Valley where dormer meets main roof (bi-slope junction)
            {"id": "V1", "label": "valley", "x1": 15, "y1": 5, "x2": 15, "y2": 9, "slope_ref": "main+dormer"},
            {"id": "V2", "label": "valley", "x1": 25, "y1": 5, "x2": 25, "y2": 9, "slope_ref": "main+dormer"},
        ],
        "slope_map": {"main": "6:12", "dormer": "12:12"},
        "default_slope": "6:12",
    }

    eng4 = RoofMeasurementEngine(mixed)
    results4 = eng4.calculate_all()
    summary4 = eng4.summary_report()

    # Check multi-slope: dormer rakes should use 12:12 (45°)
    drk1 = next(r for r in results4 if r.id == "DRK1")
    assert_close(drk1.theta_deg, 45.0, 0.1, "Dormer rake uses 12:12 (45°)")
    # Dormer rake true length: 4 / cos(45°) = 5.66 ft
    expected_drk = 4.0 / math.cos(math.radians(45.0))
    assert_close(drk1.true_length_ft, expected_drk, 0.1, "Dormer rake true length")

    # Main rake uses 6:12 (26.57°)
    rk1 = next(r for r in results4 if r.id == "RK1")
    assert_close(rk1.theta_deg, 26.57, 0.1, "Main rake uses 6:12 (26.57°)")

    # Valley should be flagged as bi-slope
    v1 = next(r for r in results4 if r.id == "V1")
    assert v1.is_bi_slope, "Valley V1 should be bi-slope"
    print(f"  ✓ Valley V1 correctly flagged as bi-slope")
    passed += 1

    # Valley theta should be average of 6:12 (0.4636 rad) and 12:12 (0.7854 rad)
    avg_theta = (math.atan(6.0 / 12.0) + math.atan(12.0 / 12.0)) / 2.0
    assert_close(v1.theta_deg, math.degrees(avg_theta), 0.2, "Valley bi-slope avg angle")

    # CSV export should work
    csv_str = eng4.export_csv()
    assert len(csv_str) > 100, "CSV export produced output"
    print(f"  ✓ CSV export: {len(csv_str)} chars")
    passed += 1

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TEST 5: Edge cases
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    print("\n━━━ TEST 5: Edge Cases ━━━")

    # Zero-length segment should be discarded
    edge_case = {
        "segments": [
            {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 10, "y2": 0},
            {"id": "ZERO", "label": "eave", "x1": 5, "y1": 5, "x2": 5, "y2": 5},  # zero-length
        ],
        "slope_map": {},
        "default_slope": "6:12",
    }
    eng5 = RoofMeasurementEngine(edge_case)
    r5 = eng5.calculate_all()
    assert len(r5) == 1, "Zero-length segment discarded"
    print(f"  ✓ Zero-length segment correctly discarded")
    passed += 1

    # Vertical slope should raise error
    try:
        normalize_slope("90", "degrees")
        print(f"  ✗ Should have raised ValueError for 90°")
        failed += 1
    except ValueError:
        print(f"  ✓ Vertical slope (90°) correctly raises ValueError")
        passed += 1

    # Multiplier < 1 should raise error
    try:
        normalize_slope("0.5", "multiplier")
        print(f"  ✗ Should have raised ValueError for multiplier < 1")
        failed += 1
    except ValueError:
        print(f"  ✓ Multiplier < 1 correctly raises ValueError")
        passed += 1

    # Flat roof: normalize_slope("0:12") → 0.0 rad
    theta_flat = normalize_slope("0:12")
    assert_close(math.degrees(theta_flat), 0.0, 0.001, "Flat pitch 0:12 → 0°")

    # Multiplier = 1.0 → flat
    theta_flat2 = normalize_slope("1.0", "multiplier")
    assert_close(math.degrees(theta_flat2), 0.0, 0.001, "Multiplier 1.0 → 0°")

    print(f"\n{'='*50}")
    print(f"  Results: {passed} passed, {failed} failed")
    print(f"{'='*50}")
    return failed == 0


# ═════════════════════════════════════════════════════════
#  Module entry point
# ═════════════════════════════════════════════════════════

if __name__ == "__main__":
    success = _run_tests()
    raise SystemExit(0 if success else 1)

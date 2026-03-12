"""
test_roof_engine.py — Pytest test cases for roof_engine.py
==========================================================
Run with:  pytest tools/test_roof_engine.py -v

Four main test cases:
  1. Simple gable roof
  2. Simple hip roof
  3. Flat roof (θ = 0)
  4. Mixed-slope dormer

Plus edge-case tests for invalid inputs.
"""

import math
import pytest

from roof_engine import (
    RoofMeasurementEngine,
    normalize_slope,
    compute_footprint_from_latlng,
)


# ─────────────────────────────────────────────────────────
#  Helper
# ─────────────────────────────────────────────────────────

def _find(results, seg_id):
    return next(r for r in results if r.id == seg_id)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 1: Simple Gable Roof
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestGableRoof:
    """40 ft × 30 ft gable, 6:12 pitch, ridge at center."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.roof = {
            "segments": [
                {"id": "E1", "label": "eave",  "x1": 0,  "y1": 0,  "x2": 40, "y2": 0},
                {"id": "E2", "label": "eave",  "x1": 40, "y1": 0,  "x2": 40, "y2": 30},
                {"id": "E3", "label": "eave",  "x1": 40, "y1": 30, "x2": 0,  "y2": 30},
                {"id": "E4", "label": "eave",  "x1": 0,  "y1": 30, "x2": 0,  "y2": 0},
                {"id": "RG1", "label": "ridge", "x1": 0,  "y1": 15, "x2": 40, "y2": 15},
                {"id": "RK1", "label": "rake",  "x1": 0,  "y1": 0,  "x2": 0,  "y2": 15, "slope_ref": "main"},
                {"id": "RK2", "label": "rake",  "x1": 40, "y1": 0,  "x2": 40, "y2": 15, "slope_ref": "main"},
            ],
            "slope_map": {"main": "6:12"},
            "default_slope": "6:12",
        }
        eng = RoofMeasurementEngine(self.roof)
        self.results = eng.calculate_all()
        self.summary = eng.summary_report()

    def test_eave_perimeter(self):
        assert abs(self.summary.total_eave_ft - 140.0) < 0.1

    def test_ridge_length(self):
        assert abs(self.summary.total_ridge_ft - 40.0) < 0.1

    def test_rake_true_length(self):
        expected = 2 * (15.0 / math.cos(math.atan(6 / 12)))
        assert abs(self.summary.total_rake_ft - expected) < 0.2

    def test_footprint_area(self):
        assert abs(self.summary.footprint_area_sqft - 1200.0) < 1.0

    def test_true_area(self):
        expected = 1200.0 / math.cos(math.atan(6 / 12))
        assert abs(self.summary.true_area_sqft - expected) < 5.0


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 2: Simple Hip Roof
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestHipRoof:
    """50 ft × 30 ft hip roof, 5:12 pitch, 20 ft ridge centered."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.roof = {
            "segments": [
                {"id": "E1", "label": "eave", "x1": 0,  "y1": 0,  "x2": 50, "y2": 0},
                {"id": "E2", "label": "eave", "x1": 50, "y1": 0,  "x2": 50, "y2": 30},
                {"id": "E3", "label": "eave", "x1": 50, "y1": 30, "x2": 0,  "y2": 30},
                {"id": "E4", "label": "eave", "x1": 0,  "y1": 30, "x2": 0,  "y2": 0},
                {"id": "RG1", "label": "ridge", "x1": 15, "y1": 15, "x2": 35, "y2": 15},
                {"id": "H1", "label": "hip", "x1": 0,  "y1": 0,  "x2": 15, "y2": 15},
                {"id": "H2", "label": "hip", "x1": 50, "y1": 0,  "x2": 35, "y2": 15},
                {"id": "H3", "label": "hip", "x1": 50, "y1": 30, "x2": 35, "y2": 15},
                {"id": "H4", "label": "hip", "x1": 0,  "y1": 30, "x2": 15, "y2": 15},
            ],
            "slope_map": {"default": "5:12"},
            "default_slope": "5:12",
        }
        eng = RoofMeasurementEngine(self.roof)
        self.results = eng.calculate_all()
        self.summary = eng.summary_report()

    def test_eave_perimeter(self):
        assert abs(self.summary.total_eave_ft - 160.0) < 0.1

    def test_ridge_length(self):
        assert abs(self.summary.total_ridge_ft - 20.0) < 0.1

    def test_hip_true_greater_than_2d(self):
        hips = [r for r in self.results if r.label == "hip"]
        assert len(hips) == 4
        for h in hips:
            assert h.true_length_ft > h.length_2d_ft

    def test_footprint_area(self):
        assert abs(self.summary.footprint_area_sqft - 1500.0) < 1.0

    def test_hip_count(self):
        assert self.summary.total_hip_ft > 80  # 4 hips × ~21 ft each


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 3: Flat Roof
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestFlatRoof:
    """60 ft × 40 ft flat roof, 0:12 pitch."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.roof = {
            "segments": [
                {"id": "E1", "label": "eave", "x1": 0,  "y1": 0,  "x2": 60, "y2": 0},
                {"id": "E2", "label": "eave", "x1": 60, "y1": 0,  "x2": 60, "y2": 40},
                {"id": "E3", "label": "eave", "x1": 60, "y1": 40, "x2": 0,  "y2": 40},
                {"id": "E4", "label": "eave", "x1": 0,  "y1": 40, "x2": 0,  "y2": 0},
            ],
            "slope_map": {},
            "default_slope": "0:12",
        }
        eng = RoofMeasurementEngine(self.roof)
        self.results = eng.calculate_all()
        self.summary = eng.summary_report()

    def test_eave_perimeter(self):
        assert abs(self.summary.total_eave_ft - 200.0) < 0.1

    def test_footprint_equals_true_area(self):
        assert abs(self.summary.footprint_area_sqft - 2400.0) < 1.0
        assert abs(self.summary.true_area_sqft - 2400.0) < 1.0

    def test_slope_factor_one(self):
        assert abs(self.summary.slope_factor - 1.0) < 0.001


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST 4: Mixed-Slope Dormer
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestMixedSlopeDormer:
    """Main roof 6:12 + dormer 12:12 with bi-slope valley junction."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.roof = {
            "segments": [
                {"id": "E1", "label": "eave", "x1": 0,  "y1": 0,  "x2": 40, "y2": 0},
                {"id": "E2", "label": "eave", "x1": 40, "y1": 0,  "x2": 40, "y2": 30},
                {"id": "E3", "label": "eave", "x1": 40, "y1": 30, "x2": 0,  "y2": 30},
                {"id": "E4", "label": "eave", "x1": 0,  "y1": 30, "x2": 0,  "y2": 0},
                {"id": "RG1", "label": "ridge", "x1": 0,  "y1": 15, "x2": 40, "y2": 15, "slope_ref": "main"},
                {"id": "RK1", "label": "rake",  "x1": 0,  "y1": 0,  "x2": 0,  "y2": 15, "slope_ref": "main"},
                {"id": "RK2", "label": "rake",  "x1": 40, "y1": 0,  "x2": 40, "y2": 15, "slope_ref": "main"},
                {"id": "DE1", "label": "eave",  "x1": 15, "y1": 5,  "x2": 25, "y2": 5},
                {"id": "DRG1", "label": "ridge", "x1": 15, "y1": 9,  "x2": 25, "y2": 9, "slope_ref": "dormer"},
                {"id": "DRK1", "label": "rake",  "x1": 15, "y1": 5,  "x2": 15, "y2": 9, "slope_ref": "dormer"},
                {"id": "DRK2", "label": "rake",  "x1": 25, "y1": 5,  "x2": 25, "y2": 9, "slope_ref": "dormer"},
                {"id": "V1", "label": "valley", "x1": 15, "y1": 5, "x2": 15, "y2": 9, "slope_ref": "main+dormer"},
                {"id": "V2", "label": "valley", "x1": 25, "y1": 5, "x2": 25, "y2": 9, "slope_ref": "main+dormer"},
            ],
            "slope_map": {"main": "6:12", "dormer": "12:12"},
            "default_slope": "6:12",
        }
        eng = RoofMeasurementEngine(self.roof)
        self.results = eng.calculate_all()
        self.summary = eng.summary_report()

    def test_dormer_uses_steep_pitch(self):
        drk1 = _find(self.results, "DRK1")
        assert abs(drk1.theta_deg - 45.0) < 0.1

    def test_dormer_rake_true_length(self):
        drk1 = _find(self.results, "DRK1")
        expected = 4.0 / math.cos(math.radians(45.0))
        assert abs(drk1.true_length_ft - expected) < 0.1

    def test_main_rake_pitch(self):
        rk1 = _find(self.results, "RK1")
        assert abs(rk1.theta_deg - 26.57) < 0.1

    def test_valley_bi_slope(self):
        v1 = _find(self.results, "V1")
        assert v1.is_bi_slope is True

    def test_valley_avg_theta(self):
        v1 = _find(self.results, "V1")
        avg = (math.atan(6 / 12) + math.atan(12 / 12)) / 2
        assert abs(v1.theta_deg - math.degrees(avg)) < 0.2

    def test_csv_export(self):
        eng = RoofMeasurementEngine(self.roof)
        eng.calculate_all()
        csv = eng.export_csv()
        assert len(csv) > 100


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Edge Cases
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class TestEdgeCases:
    def test_zero_length_discarded(self):
        roof = {
            "segments": [
                {"id": "E1", "label": "eave", "x1": 0, "y1": 0, "x2": 10, "y2": 0},
                {"id": "ZERO", "label": "eave", "x1": 5, "y1": 5, "x2": 5, "y2": 5},
            ],
            "default_slope": "6:12",
        }
        eng = RoofMeasurementEngine(roof)
        results = eng.calculate_all()
        assert len(results) == 1

    def test_vertical_slope_raises(self):
        with pytest.raises(ValueError):
            normalize_slope("90", "degrees")

    def test_multiplier_below_one_raises(self):
        with pytest.raises(ValueError):
            normalize_slope("0.5", "multiplier")

    def test_flat_pitch(self):
        theta = normalize_slope("0:12")
        assert abs(theta) < 1e-6

    def test_multiplier_one_is_flat(self):
        theta = normalize_slope("1.0", "multiplier")
        assert abs(theta) < 1e-6

    def test_auto_classify_horizontal(self):
        roof = {
            "segments": [
                {"id": "S1", "label": "unknown", "x1": 0, "y1": 0, "x2": 20, "y2": 0},
            ],
            "default_slope": "6:12",
        }
        eng = RoofMeasurementEngine(roof)
        results = eng.calculate_all()
        assert results[0].label == "eave"
        assert results[0].auto_classified is True

    def test_latlng_area(self):
        # ~30m × 30m square near Edmonton (53°N)
        pts = [
            {"lat": 53.5, "lng": -113.5},
            {"lat": 53.5, "lng": -113.4996},
            {"lat": 53.5003, "lng": -113.4996},
            {"lat": 53.5003, "lng": -113.5},
        ]
        area = compute_footprint_from_latlng(pts)
        assert area > 100  # should be ~10,000+ sqft

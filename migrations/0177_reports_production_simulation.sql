-- Cache PVWatts V8 simulation per report so we don't burn free-tier quota
-- (NREL rate-limits at 30 req/hr unauth, 1000/hr with a key) on every page load.
-- Shape: { annual_kwh_pvwatts, monthly_kwh:number[12], per_segment:[{kwh,capacity_factor}...], source:'pvwatts_v8', ran_at }
ALTER TABLE reports ADD COLUMN production_simulation_json TEXT;

-- Migration 0025: Add trace_measurement_json column to orders
-- Stores the pre-calculated measurement engine results from the order form
-- This data is computed client-side before the user submits their order
ALTER TABLE orders ADD COLUMN trace_measurement_json TEXT;

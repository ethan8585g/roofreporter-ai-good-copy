-- ============================================================
-- Migration 0111: Add API source tracking to orders
-- Links orders table to the public API jobs system
-- ============================================================

ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'web';
-- source values: 'web' | 'api'

ALTER TABLE orders ADD COLUMN api_job_id TEXT;
-- FK to api_jobs.id — only set when source = 'api'

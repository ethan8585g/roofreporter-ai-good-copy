-- Dispatch board: add geocode + optimized route order to crm_jobs
ALTER TABLE crm_jobs ADD COLUMN lat REAL;
ALTER TABLE crm_jobs ADD COLUMN lng REAL;
ALTER TABLE crm_jobs ADD COLUMN route_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_crm_jobs_scheduled_date ON crm_jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_job_crew_assignments_crew ON job_crew_assignments(crew_member_id);

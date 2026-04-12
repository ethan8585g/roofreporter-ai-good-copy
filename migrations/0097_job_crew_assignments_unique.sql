-- Dedupe existing job_crew_assignments then enforce uniqueness on (job_id, crew_member_id)
DELETE FROM job_crew_assignments
WHERE id NOT IN (
  SELECT MIN(id) FROM job_crew_assignments GROUP BY job_id, crew_member_id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jca_unique ON job_crew_assignments(job_id, crew_member_id);

-- ============================================================
-- Reconcile signup_journey loop cadence (declared vs actual)
-- 0227 seeded expected_period_seconds = 3600 (every hour) but the
-- cron worker fires it every 6 hours (hour % 6 === 0). The loop
-- tracker UI was flagging signup_journey as "stale" between fires.
-- Update the declared period to match the real cadence.
-- ============================================================

UPDATE loop_definitions
   SET expected_period_seconds = 21600,
       schedule_cron            = '0 */6 * * *',
       schedule_human           = 'Every 6h at :00'
 WHERE loop_id = 'signup_journey';

-- Backfill historical share opens into report_view_events.
-- Migration 0216 added the per-event log, but pre-existing opens were only
-- counted in reports.share_view_count and never logged as rows. This inserts
-- one synthetic row per pre-existing count so the super-admin Views pill
-- reflects historical opens. user_agent is tagged so backfilled rows are
-- distinguishable from real opens; viewed_at falls back to share_sent_at
-- (when the link went out) since the actual open time isn't recorded.

INSERT INTO report_view_events
  (order_id, report_id, view_type, customer_id, ip_address, user_agent, share_token, is_bot, viewed_at)
SELECT
  r.order_id,
  r.id,
  'share',
  NULL,
  NULL,
  '[backfilled from share_view_count]',
  r.share_token,
  0,
  COALESCE(r.share_sent_at, r.updated_at, datetime('now'))
FROM reports r
WHERE r.share_view_count > 0
  AND r.order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM report_view_events rve
    WHERE rve.order_id = r.order_id
      AND rve.user_agent = '[backfilled from share_view_count]'
  );

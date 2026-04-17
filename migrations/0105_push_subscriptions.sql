-- No-op: push_subscriptions table already created in 0074 with a different
-- schema.  The 0074 version uses user_type+user_id; this migration attempted
-- to redefine with customer_id+endpoint which conflicts.  Skipped.
SELECT 1;

-- No-op: material_delivery_date was already added in migration 0069.
-- Original migration used ALTER TABLE ... IF NOT EXISTS which is
-- invalid SQLite syntax.
SELECT 1;

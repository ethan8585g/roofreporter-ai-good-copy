-- Optional "send completed report here" email captured on the order form
-- (below the address upload). Used as the top-priority auto-send recipient
-- when the report finishes generating.
ALTER TABLE orders ADD COLUMN send_report_to_email TEXT;

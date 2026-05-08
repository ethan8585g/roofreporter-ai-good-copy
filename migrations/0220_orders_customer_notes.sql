-- Customer-supplied special notes/requests captured at order time
-- (e.g. "include detached garage", "include shed", "flat roof on the back").
-- Distinct from the existing `notes` column, which is overloaded for
-- payment metadata ("Paid via credit balance" / "Free trial report …")
-- and used by revenue-reporting filters.
ALTER TABLE orders ADD COLUMN customer_notes TEXT;

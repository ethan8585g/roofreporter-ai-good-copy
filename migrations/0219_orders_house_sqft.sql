-- Adds the house_sqft column referenced by /api/square/use-credit (commit eab99a7)
-- and by admin trace preview to set scale. Without this column, every
-- /use-credit INSERT throws "no such column: house_sqft" and the customer
-- sees a generic "Failed to use credit" error.
ALTER TABLE orders ADD COLUMN house_sqft REAL;

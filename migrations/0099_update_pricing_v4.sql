-- Pricing v4: $8 individual, $7.50/ea 10-pack, $7/ea 25-pack, $5.95/ea 100-pack
DELETE FROM credit_packages;

INSERT INTO credit_packages (name, description, credits, price_cents, sort_order, is_active) VALUES
  ('Individual Report', 'Single roof measurement report — $8', 1, 800, 1, 1),
  ('10-Pack', '10 reports — $7.50/each (save 6%)', 10, 7500, 2, 1),
  ('25-Pack', '25 reports — $7.00/each (save 13%)', 25, 17500, 3, 1),
  ('100-Pack', '100 reports — $5.95/each (save 26%)', 100, 59500, 4, 1);

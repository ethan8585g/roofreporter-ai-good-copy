-- Update credit packages: $5 USD individual, 25-pack, 100-pack only
DELETE FROM credit_packages;

INSERT INTO credit_packages (name, description, credits, price_cents, sort_order, is_active) VALUES
  ('Individual Report', 'One professional roof measurement report', 1, 500, 1, 1),
  ('25-Pack', '25 reports — save 21%', 25, 9900, 2, 1),
  ('100-Pack', '100 reports — save 40%', 100, 29900, 3, 1);

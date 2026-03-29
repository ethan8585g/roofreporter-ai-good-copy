-- ============================================================
-- Migration 0045: New USD pricing structure
-- Membership plans: free / pro ($49.99/mo) / pro_plus ($199/mo) / enterprise (contact)
-- Report credit packs: 1=$5, 25=$106.25, 100=$350 (all USD)
-- ============================================================

-- Replace all existing credit packages with new USD pricing
DELETE FROM credit_packages;

INSERT INTO credit_packages (name, description, credits, price_cents, is_active, sort_order) VALUES
  ('Single Report',  '1 individual roof measurement report',               1,     500, 1, 1),
  ('25-Pack',        '25 roof measurement reports — save 15%',            25,   10625, 1, 2),
  ('100-Pack',       '100 roof measurement reports — best value, save 30%', 100, 35000, 1, 3);

-- Pricing v5: Remove $8 single-report option; offer only 10/25/50/100 packs
UPDATE credit_packages SET is_active = 0 WHERE credits = 1;

INSERT INTO credit_packages (name, description, credits, price_cents, sort_order, is_active)
  VALUES ('50-Pack', '50 reports — $6.50/each (save 19%)', 50, 32500, 4, 1);

UPDATE credit_packages SET sort_order = 1, description = '10 reports — $7.50/each (save 6%)'  WHERE credits = 10  AND is_active = 1;
UPDATE credit_packages SET sort_order = 2, description = '25 reports — $7.00/each (save 13%)' WHERE credits = 25  AND is_active = 1;
UPDATE credit_packages SET sort_order = 3                                                       WHERE credits = 50  AND is_active = 1;
UPDATE credit_packages SET sort_order = 4, description = '100 reports — $5.95/each (save 26%)' WHERE credits = 100 AND is_active = 1;

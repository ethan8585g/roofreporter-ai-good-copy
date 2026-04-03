-- Update pricing: $7/report individual, $6/report 25-pack, $5/report 100-pack
UPDATE credit_packages SET price_cents = 700, name = 'Individual Report', description = 'Single roof measurement report — $7' WHERE credits = 1 AND is_active = 1;
UPDATE credit_packages SET price_cents = 15000, name = '25-Pack', description = '25 roof measurement reports — $6/each (save 14%)' WHERE credits = 25 AND is_active = 1;
UPDATE credit_packages SET price_cents = 50000, name = '100-Pack', description = '100 roof measurement reports — $5/each (save 29%)' WHERE credits = 100 AND is_active = 1;

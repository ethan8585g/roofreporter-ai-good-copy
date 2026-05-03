-- Pricing v6 (CAD): 10@$8/ea, 25@$7.50/ea, 50@$6.95/ea, 100@$5.95/ea
-- Per-pack totals: 10=$80, 25=$187.50, 50=$347.50, 100=$595
UPDATE credit_packages SET price_cents =  8000, description = '10 reports — $8.00/each'  WHERE credits = 10  AND is_active = 1;
UPDATE credit_packages SET price_cents = 18750, description = '25 reports — $7.50/each (save 6%)'  WHERE credits = 25  AND is_active = 1;
UPDATE credit_packages SET price_cents = 34750, description = '50 reports — $6.95/each (save 13%)' WHERE credits = 50  AND is_active = 1;
UPDATE credit_packages SET price_cents = 59500, description = '100 reports — $5.95/each (save 26%)' WHERE credits = 100 AND is_active = 1;

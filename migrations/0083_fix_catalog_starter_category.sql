-- Rename starter_strip category to starter to match material calculator category key
UPDATE material_catalog SET category = 'starter' WHERE category = 'starter_strip';

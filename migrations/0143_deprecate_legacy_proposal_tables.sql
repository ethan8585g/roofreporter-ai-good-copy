-- ============================================================
-- Migration 0143: Deprecate legacy crm_proposals / crm_invoices
-- Phase 1 of the Proposal Builder Elite Upgrade
--
-- The canonical document table is `invoices` with document_type
-- IN ('invoice','proposal','estimate'). The legacy `crm_proposals`
-- and `crm_invoices` tables are being phased out.
--
-- This migration:
--   1. Copies non-duplicate crm_proposals rows into invoices
--   2. Creates a v_proposals view on top of invoices
--   3. Adds AFTER INSERT triggers that block new rows in the legacy tables
-- ============================================================

-- 1. Copy crm_proposals into invoices where they don't already exist
--    (match on proposal_number to avoid duplicates)
--    crm_proposals columns:
--      total_amount → invoices.total
--      owner_id → invoices.customer_id (owner_id references customers.id)
--      labor_cost + material_cost + other_cost → subtotal (crm_proposals has no subtotal column)
--      No tax_rate/tax_amount columns — default to 5% GST
INSERT INTO invoices (
  invoice_number, customer_id, crm_customer_id, crm_customer_name, crm_customer_email,
  order_id, subtotal, tax_rate, tax_amount, total, status,
  notes, terms, document_type, scope_of_work,
  valid_until, share_token, share_url, customer_signature, printed_name, signed_at,
  viewed_count, viewed_at, certificate_sent_at, proposal_group_id, proposal_tier,
  created_at, updated_at
)
SELECT
  cp.proposal_number,
  cp.owner_id,                                       -- maps to customers.id
  cp.crm_customer_id,
  COALESCE(cc.name, ''),
  COALESCE(cc.email, ''),
  NULL,                                              -- no order_id on crm_proposals
  COALESCE(cp.labor_cost, 0) + COALESCE(cp.material_cost, 0) + COALESCE(cp.other_cost, 0),  -- subtotal
  5.0,                                               -- default GST rate
  ROUND((COALESCE(cp.labor_cost, 0) + COALESCE(cp.material_cost, 0) + COALESCE(cp.other_cost, 0)) * 0.05, 2),  -- tax_amount
  COALESCE(cp.total_amount, 0),
  cp.status,
  cp.notes,
  'This proposal is valid for 30 days from the date of issue.',
  'proposal',
  cp.scope_of_work,
  cp.valid_until,
  cp.share_token,
  CASE WHEN cp.share_token IS NOT NULL AND cp.share_token != ''
       THEN '/proposal/view/' || cp.share_token ELSE '' END,
  cp.customer_signature,
  cp.printed_name,
  cp.signed_at,
  COALESCE(cp.view_count, 0),
  cp.last_viewed_at,
  cp.certificate_sent_at,
  COALESCE(cp.proposal_group_id, ''),
  COALESCE(cp.tier_label, ''),
  cp.created_at,
  cp.updated_at
FROM crm_proposals cp
LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
WHERE NOT EXISTS (
  SELECT 1 FROM invoices i
  WHERE i.invoice_number = cp.proposal_number
);

-- 2. Copy crm_proposal_items for newly-copied proposals into invoice_items
INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order, unit)
SELECT
  inv.id,
  cpi.description,
  cpi.quantity,
  cpi.unit_price,
  cpi.amount,
  cpi.sort_order,
  COALESCE(cpi.unit, 'each')
FROM crm_proposal_items cpi
JOIN crm_proposals cp ON cp.id = cpi.proposal_id
JOIN invoices inv ON inv.invoice_number = cp.proposal_number AND inv.document_type = 'proposal'
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_items ii
  WHERE ii.invoice_id = inv.id AND ii.description = cpi.description AND ii.sort_order = cpi.sort_order
);

-- 3. Create a convenience view for proposals
CREATE VIEW IF NOT EXISTS v_proposals AS
SELECT * FROM invoices WHERE document_type = 'proposal';

-- 4. Add deprecation triggers — block NEW inserts into legacy tables.
--    D1 (SQLite) supports RAISE(ABORT, ...) inside triggers.
CREATE TRIGGER IF NOT EXISTS crm_proposals_deprecated_insert
AFTER INSERT ON crm_proposals
BEGIN
  SELECT RAISE(ABORT, 'DEPRECATED: crm_proposals is read-only. Use invoices with document_type=proposal instead.');
END;

CREATE TRIGGER IF NOT EXISTS crm_invoices_deprecated_insert
AFTER INSERT ON crm_invoices
BEGIN
  SELECT RAISE(ABORT, 'DEPRECATED: crm_invoices is read-only. Use invoices table instead.');
END;

-- 5. Add a mapping column so we can trace back to the original crm_proposals.id
--    for any downstream references (crm_jobs.proposal_id, etc.)
ALTER TABLE invoices ADD COLUMN legacy_crm_proposal_id INTEGER DEFAULT NULL;

-- Backfill the mapping for rows we just copied
UPDATE invoices SET legacy_crm_proposal_id = (
  SELECT cp.id FROM crm_proposals cp WHERE cp.proposal_number = invoices.invoice_number
)
WHERE document_type = 'proposal' AND legacy_crm_proposal_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_legacy_crm_proposal ON invoices(legacy_crm_proposal_id);

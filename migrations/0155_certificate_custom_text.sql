-- Add customizable text fields to certificate_designs
-- Allows roofers to change title, subtitle, body text, footer, and signature labels
ALTER TABLE certificate_designs ADD COLUMN cert_title TEXT DEFAULT 'Certificate of New Roof Installation';
ALTER TABLE certificate_designs ADD COLUMN cert_subtitle TEXT DEFAULT 'Official Documentation for Insurance Purposes';
ALTER TABLE certificate_designs ADD COLUMN cert_body_text TEXT;
ALTER TABLE certificate_designs ADD COLUMN footer_text TEXT;
ALTER TABLE certificate_designs ADD COLUMN sig_left_label TEXT DEFAULT 'Authorized by Roofing Contractor';
ALTER TABLE certificate_designs ADD COLUMN sig_right_label TEXT DEFAULT 'Acknowledged by Homeowner';

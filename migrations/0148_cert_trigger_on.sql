-- Certificate trigger preference: send on proposal_signed or install_completed
ALTER TABLE customers ADD COLUMN cert_trigger_on TEXT DEFAULT 'install_completed';

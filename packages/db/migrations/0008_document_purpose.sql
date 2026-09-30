ALTER TABLE documents
  ADD COLUMN purpose text NOT NULL DEFAULT 'DEAL'
  CHECK (purpose IN ('DEAL','DISPUTE'));

CREATE INDEX documents_claim_purpose ON documents(claim_id,purpose,created_at);

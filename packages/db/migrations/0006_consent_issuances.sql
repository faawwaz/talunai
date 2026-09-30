-- A typed-data payload can be signed after it leaves the server even when the
-- browser never submits the signature. Record the issuance before responding.
CREATE TABLE consent_issuances (
  id text PRIMARY KEY,
  claim_id text NOT NULL REFERENCES claims(id),
  version integer NOT NULL,
  role text NOT NULL CHECK (role IN ('BORROWER', 'BUYER')),
  signer text NOT NULL,
  nonce text NOT NULL,
  deadline integer NOT NULL,
  terms_hash text NOT NULL,
  chain_id integer NOT NULL,
  registry_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX consent_issuances_chain_nonce
  ON consent_issuances(chain_id, registry_address, signer, nonce);
CREATE INDEX consent_issuances_claim_version ON consent_issuances(claim_id, version);

-- Keep every submitted signature. Only one may be selected for registration
-- for a given claim/version/role at any instant.
ALTER TABLE consent_records DROP CONSTRAINT IF EXISTS consent_records_claim_id_version_role_key;
DROP INDEX IF EXISTS consent_unique;
CREATE UNIQUE INDEX consent_current_unique
  ON consent_records(claim_id, version, role) WHERE revoked = false;
CREATE INDEX consent_records_claim_history ON consent_records(claim_id, version);

-- The worker owns a claim run only while its execution token matches.
ALTER TABLE agent_runs ADD COLUMN execution_token uuid;

CREATE TABLE access_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  wallet text NOT NULL REFERENCES wallets(address),
  organization_name text NOT NULL,
  requested_role text NOT NULL CHECK (requested_role IN ('BORROWER','BUYER','LENDER')),
  note text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  organization_id text REFERENCES organizations(id),
  review_reason text,
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='PENDING' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL)
    OR (status<>'PENDING' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_reason IS NOT NULL)),
  CHECK (status<>'APPROVED' OR organization_id IS NOT NULL)
);
CREATE UNIQUE INDEX access_request_one_pending ON access_requests(user_id) WHERE status='PENDING';
CREATE INDEX access_request_owner ON access_requests(user_id,created_at DESC);
-- Operator-maintained names/aliases are identity collision checks, not proof of KYB.
CREATE TABLE organization_aliases (
  alias_key text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id)
);
INSERT INTO organization_aliases(alias_key,organization_id)
  SELECT regexp_replace(lower(normalize(name,NFKC)), '[^[:alnum:]]', '', 'g'), id FROM organizations;
CREATE TABLE synthetic_organization_identities (
  identity_key text PRIMARY KEY,
  organization_id text NOT NULL UNIQUE REFERENCES organizations(id)
);

CREATE TABLE chain_blocks (
  chain_id integer NOT NULL,
  block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL,
  PRIMARY KEY(chain_id,block_number)
);
CREATE TABLE worker_heartbeats (
  id text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  error_code text
);

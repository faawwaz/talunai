-- Historical rows remain unknown until receipt verification supplies the
-- original log emitter. A nonce invalidation from another contract must never
-- be accepted as consent revocation for the configured registry.
ALTER TABLE chain_events ADD COLUMN contract_address text;
ALTER TABLE chain_events ADD CONSTRAINT chain_event_contract_address_format
  CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$');
CREATE INDEX chain_event_emitter_nonce
  ON chain_events(chain_id, contract_address, event_name)
  WHERE canonical = true AND event_name = 'ConsentNonceInvalidated';

ALTER TABLE worker_heartbeats
  ADD COLUMN provider_mode text CHECK (provider_mode IN ('mock', 'live')),
  ADD COLUMN provider_model text;

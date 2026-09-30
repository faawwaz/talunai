-- Existing receivables keep their financial terms. Missing goods metadata remains NULL
-- and requires explicit review; it is never backfilled with a cocoa assumption.
ALTER TABLE claims ADD COLUMN asset_type text NOT NULL DEFAULT 'TRADE_RECEIVABLE';
ALTER TABLE claims ADD COLUMN goods jsonb;
ALTER TABLE claims ADD CONSTRAINT claims_asset_type_fixed CHECK (asset_type = 'TRADE_RECEIVABLE');
ALTER TABLE claims ADD CONSTRAINT claims_goods_object CHECK (goods IS NULL OR jsonb_typeof(goods) = 'object');

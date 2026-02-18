ALTER TABLE orders
  ALTER COLUMN notional_usd TYPE double precision,
  ALTER COLUMN filled_qty TYPE double precision,
  ALTER COLUMN avg_fill_px TYPE double precision;

ALTER TABLE fills
  ALTER COLUMN filled_qty TYPE double precision,
  ALTER COLUMN avg_fill_px TYPE double precision,
  ALTER COLUMN notional_usd TYPE double precision;

ALTER TABLE positions
  ALTER COLUMN qty TYPE double precision,
  ALTER COLUMN notional_usd TYPE double precision,
  ALTER COLUMN avg_entry_px TYPE double precision,
  ALTER COLUMN mark_px TYPE double precision,
  ALTER COLUMN pnl_usd TYPE double precision;

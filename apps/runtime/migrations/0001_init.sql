BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS system_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  external_id TEXT NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  quota_remaining INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tier_capabilities (
  tier TEXT PRIMARY KEY,
  capabilities JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  notional_usd INTEGER NOT NULL,
  filled_qty INTEGER NOT NULL,
  avg_fill_px INTEGER NOT NULL,
  exchange_order_id TEXT,
  closed_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  exchange_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  filled_qty INTEGER NOT NULL,
  avg_fill_px INTEGER NOT NULL,
  notional_usd INTEGER NOT NULL,
  source TEXT NOT NULL,
  raw_event_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  qty INTEGER NOT NULL,
  notional_usd INTEGER NOT NULL,
  avg_entry_px INTEGER NOT NULL,
  mark_px INTEGER NOT NULL,
  pnl_usd INTEGER NOT NULL,
  user_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  details JSONB,
  hash TEXT
);

CREATE TABLE IF NOT EXISTS commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  args JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  entitlement_id UUID,
  challenge_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount_usd INTEGER NOT NULL,
  tx_ref TEXT,
  verification_payload JSONB NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users (external_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_expires ON entitlements (expires_at);
CREATE INDEX IF NOT EXISTS idx_entitlements_tier ON entitlements (tier);
CREATE INDEX IF NOT EXISTS idx_tier_capabilities_updated_at ON tier_capabilities (updated_at);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders (symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders (source);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_unique ON orders (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills (order_id);
CREATE INDEX IF NOT EXISTS idx_fills_symbol ON fills (symbol);
CREATE INDEX IF NOT EXISTS idx_fills_created_at ON fills (created_at);
CREATE INDEX IF NOT EXISTS idx_fills_source ON fills (source);
CREATE INDEX IF NOT EXISTS idx_positions_symbol_side ON positions (symbol, side);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions (user_id);
CREATE INDEX IF NOT EXISTS idx_positions_pnl ON positions (pnl_usd);
CREATE INDEX IF NOT EXISTS idx_audits_correlation ON audits (correlation_id);
CREATE INDEX IF NOT EXISTS idx_audits_action ON audits (action);
CREATE INDEX IF NOT EXISTS idx_audits_actor ON audits (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audits_ts ON audits (ts);
CREATE INDEX IF NOT EXISTS idx_commands_command ON commands (command);
CREATE INDEX IF NOT EXISTS idx_commands_created_at ON commands (created_at);
CREATE INDEX IF NOT EXISTS idx_payments_agent ON payments (agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at);
CREATE INDEX IF NOT EXISTS idx_payments_entitlement ON payments (entitlement_id);

INSERT INTO tier_capabilities (tier, capabilities)
VALUES
  ('tier0', '["stream.read.public","command.status"]'::jsonb),
  ('tier1', '["stream.read.public","command.status","stream.read.obfuscated.realtime","command.explain.redacted"]'::jsonb),
  ('tier2', '["stream.read.public","stream.read.obfuscated.realtime","stream.read.full","command.status","command.explain.redacted","command.positions","command.execute","plugin.health.read"]'::jsonb),
  ('tier3', '["stream.read.public","stream.read.obfuscated.realtime","stream.read.full","command.status","command.explain.redacted","command.positions","command.execute","plugin.health.read","plugin.submit","command.audit"]'::jsonb)
ON CONFLICT (tier) DO NOTHING;

COMMIT;

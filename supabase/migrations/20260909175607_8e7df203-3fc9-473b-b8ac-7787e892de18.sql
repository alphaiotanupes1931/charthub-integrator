ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS live_venue text NOT NULL DEFAULT 'oanda',
  ADD COLUMN IF NOT EXISTS manage_trades boolean NOT NULL DEFAULT true;
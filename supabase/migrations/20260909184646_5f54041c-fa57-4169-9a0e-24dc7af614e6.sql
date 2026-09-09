ALTER TABLE public.autopilot_settings
  ADD COLUMN IF NOT EXISTS manage_partials boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trail_after_tp1 boolean NOT NULL DEFAULT true;

ALTER TABLE public.autopilot_settings ALTER COLUMN account_target SET DEFAULT 'live';

UPDATE public.autopilot_settings SET account_target = 'live' WHERE account_target <> 'live';
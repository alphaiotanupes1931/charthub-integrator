CREATE TABLE public.autopilot_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'manual',
  account_target TEXT NOT NULL DEFAULT 'paper',
  min_grade TEXT NOT NULL DEFAULT 'A',
  risk_pct NUMERIC NOT NULL DEFAULT 0.5,
  max_open_positions INTEGER NOT NULL DEFAULT 2,
  max_daily_loss_pct NUMERIC NOT NULL DEFAULT 3,
  allowed_symbols TEXT[] NOT NULL DEFAULT ARRAY['XAU/USD','EUR/USD','NAS100','SPX500'],
  session_windows TEXT[] NOT NULL DEFAULT ARRAY['london','newyork'],
  live_acknowledged_at TIMESTAMP WITH TIME ZONE,
  paused_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_mode_check CHECK (mode IN ('manual','confirm','auto')),
  CONSTRAINT autopilot_target_check CHECK (account_target IN ('paper','live')),
  CONSTRAINT autopilot_grade_check CHECK (min_grade IN ('A+','A','B'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_settings TO authenticated;
GRANT ALL ON public.autopilot_settings TO service_role;
ALTER TABLE public.autopilot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own autopilot settings" ON public.autopilot_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.autopilot_proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT,
  side TEXT NOT NULL,
  grade TEXT,
  confidence NUMERIC,
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  units NUMERIC,
  risk_pct NUMERIC,
  order_type TEXT NOT NULL DEFAULT 'market',
  account_target TEXT NOT NULL DEFAULT 'paper',
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  broker_order_id TEXT,
  realized_r NUMERIC,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '15 minutes'),
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_side_check CHECK (side IN ('long','short')),
  CONSTRAINT autopilot_status_check CHECK (status IN ('pending','approved','rejected','expired','filled','failed','blocked'))
);

CREATE INDEX autopilot_proposals_user_created_idx ON public.autopilot_proposals (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.autopilot_proposals TO authenticated;
GRANT ALL ON public.autopilot_proposals TO service_role;
ALTER TABLE public.autopilot_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own autopilot proposals" ON public.autopilot_proposals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_autopilot_settings_updated_at BEFORE UPDATE ON public.autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_autopilot_proposals_updated_at BEFORE UPDATE ON public.autopilot_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
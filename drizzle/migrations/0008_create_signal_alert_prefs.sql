CREATE TABLE public.signal_alert_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  min_grade text NOT NULL DEFAULT 'A',
  symbols text[] NOT NULL DEFAULT ARRAY['XAU/USD','EUR/USD','NAS100']::text[],
  models text[] NOT NULL DEFAULT ARRAY['classic']::text[],
  timezone text NOT NULL DEFAULT 'America/New_York',
  quiet_from integer NOT NULL DEFAULT 22,
  quiet_to integer NOT NULL DEFAULT 6,
  last_alert_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_alert_prefs TO authenticated;
GRANT ALL ON public.signal_alert_prefs TO service_role;

ALTER TABLE public.signal_alert_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own signal alert prefs" ON public.signal_alert_prefs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER signal_alert_prefs_touch
  BEFORE UPDATE ON public.signal_alert_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX signal_alert_prefs_enabled_idx ON public.signal_alert_prefs (enabled) WHERE enabled;

CREATE TABLE public.price_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('above','below')),
  price NUMERIC NOT NULL,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  auto_delete BOOLEAN NOT NULL DEFAULT true,
  triggered_at TIMESTAMPTZ,
  last_checked_price NUMERIC,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT ALL ON public.price_alerts TO service_role;

ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own alerts" ON public.price_alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own alerts" ON public.price_alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own alerts" ON public.price_alerts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own alerts" ON public.price_alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX price_alerts_user_idx ON public.price_alerts (user_id, created_at DESC);
CREATE INDEX price_alerts_active_idx ON public.price_alerts (active) WHERE active = true;

CREATE TRIGGER price_alerts_touch_updated
  BEFORE UPDATE ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
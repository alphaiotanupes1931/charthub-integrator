CREATE TABLE public.paper_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL DEFAULT '60',
  trade_style text NOT NULL DEFAULT 'intraday',
  min_grade text NOT NULL DEFAULT 'A',
  status text NOT NULL DEFAULT 'paused',
  methodology_version text NOT NULL DEFAULT '2026.09-v1',
  last_tick_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_bots TO authenticated;
GRANT ALL ON public.paper_bots TO service_role;
ALTER TABLE public.paper_bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage paper bots" ON public.paper_bots FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.paper_bot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.paper_bots(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_bot_events_bot_idx ON public.paper_bot_events (bot_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_bot_events TO authenticated;
GRANT ALL ON public.paper_bot_events TO service_role;
ALTER TABLE public.paper_bot_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view paper bot events" ON public.paper_bot_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.paper_bot_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.paper_bots(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  side text NOT NULL,
  entry numeric NOT NULL,
  stop numeric NOT NULL,
  tp1 numeric,
  grade text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  result text,
  realized_r numeric,
  exit_price numeric,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_bot_trades_bot_idx ON public.paper_bot_trades (bot_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_bot_trades TO authenticated;
GRANT ALL ON public.paper_bot_trades TO service_role;
ALTER TABLE public.paper_bot_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view paper bot trades" ON public.paper_bot_trades FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_paper_bots_updated_at BEFORE UPDATE ON public.paper_bots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_paper_bot_trades_updated_at BEFORE UPDATE ON public.paper_bot_trades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
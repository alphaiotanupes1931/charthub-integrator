CREATE TABLE public.strategy_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  trades INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  expectancy_r NUMERIC NOT NULL DEFAULT 0,
  net_r NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'backtest',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, strategy_id, symbol, timeframe)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_performance TO authenticated;
GRANT ALL ON public.strategy_performance TO service_role;
ALTER TABLE public.strategy_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own strategy performance" ON public.strategy_performance FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER strategy_performance_touch BEFORE UPDATE ON public.strategy_performance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.bridge_tokens (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_tokens TO authenticated;
GRANT ALL ON public.bridge_tokens TO service_role;
ALTER TABLE public.bridge_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bridge token" ON public.bridge_tokens FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.bridge_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  venue TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market',
  quantity NUMERIC NOT NULL,
  price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  broker_order_id TEXT,
  error TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bridge_orders TO authenticated;
GRANT ALL ON public.bridge_orders TO service_role;
ALTER TABLE public.bridge_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bridge orders" ON public.bridge_orders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER bridge_orders_touch BEFORE UPDATE ON public.bridge_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.journal_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  summary TEXT NOT NULL,
  mistakes JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  correlations JSONB NOT NULL DEFAULT '{}'::jsonb,
  trade_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_reviews TO authenticated;
GRANT ALL ON public.journal_reviews TO service_role;
ALTER TABLE public.journal_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own journal reviews" ON public.journal_reviews FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
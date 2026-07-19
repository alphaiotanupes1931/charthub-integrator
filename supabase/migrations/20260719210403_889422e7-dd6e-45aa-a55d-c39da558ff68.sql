
-- =========================================================
-- Paper trading
-- =========================================================

CREATE TABLE public.paper_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  starting_balance NUMERIC(18,2) NOT NULL DEFAULT 10000,
  balance NUMERIC(18,2) NOT NULL DEFAULT 10000,
  peak_equity NUMERIC(18,2) NOT NULL DEFAULT 10000,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused_for_review','off')),
  paused_reason TEXT,
  testing_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_accounts TO authenticated;
GRANT ALL ON public.paper_accounts TO service_role;
ALTER TABLE public.paper_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own paper account" ON public.paper_accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER paper_accounts_touch BEFORE UPDATE ON public.paper_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.paper_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  size NUMERIC(18,6) NOT NULL,
  entry NUMERIC(18,6) NOT NULL,
  stop NUMERIC(18,6) NOT NULL,
  take_profit NUMERIC(18,6),
  grade TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta JSONB
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_positions TO authenticated;
GRANT ALL ON public.paper_positions TO service_role;
ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own positions" ON public.paper_positions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX paper_positions_user_idx ON public.paper_positions(user_id);

CREATE TABLE public.paper_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  size NUMERIC(18,6) NOT NULL,
  entry NUMERIC(18,6) NOT NULL,
  exit NUMERIC(18,6) NOT NULL,
  stop NUMERIC(18,6),
  take_profit NUMERIC(18,6),
  pnl NUMERIC(18,2) NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('tp','sl','kill_switch','manual','timeout')),
  grade TEXT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_trades TO authenticated;
GRANT ALL ON public.paper_trades TO service_role;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own trades" ON public.paper_trades FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX paper_trades_user_idx ON public.paper_trades(user_id, closed_at DESC);

CREATE TABLE public.paper_equity_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  equity NUMERIC(18,2) NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_equity_snapshots TO authenticated;
GRANT ALL ON public.paper_equity_snapshots TO service_role;
ALTER TABLE public.paper_equity_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own snapshots" ON public.paper_equity_snapshots FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX paper_equity_user_idx ON public.paper_equity_snapshots(user_id, taken_at DESC);

-- =========================================================
-- Briefings + Telegram link
-- =========================================================

CREATE TABLE public.briefing_prefs (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  morning_enabled BOOLEAN NOT NULL DEFAULT true,
  evening_enabled BOOLEAN NOT NULL DEFAULT true,
  morning_hour INT NOT NULL DEFAULT 7 CHECK (morning_hour BETWEEN 0 AND 23),
  evening_hour INT NOT NULL DEFAULT 21 CHECK (evening_hour BETWEEN 0 AND 23),
  telegram_chat_id BIGINT,
  telegram_link_code TEXT UNIQUE,
  watchlist TEXT[] NOT NULL DEFAULT ARRAY['XAUUSD','EURUSD','^GSPC','^NDX']::TEXT[],
  last_morning_at TIMESTAMPTZ,
  last_evening_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_prefs TO authenticated;
GRANT ALL ON public.briefing_prefs TO service_role;
ALTER TABLE public.briefing_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own prefs" ON public.briefing_prefs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER briefing_prefs_touch BEFORE UPDATE ON public.briefing_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('morning','evening','ad_hoc','kill_switch')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered_telegram BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefings TO authenticated;
GRANT ALL ON public.briefings TO service_role;
ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own briefings" ON public.briefings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX briefings_user_idx ON public.briefings(user_id, sent_at DESC);

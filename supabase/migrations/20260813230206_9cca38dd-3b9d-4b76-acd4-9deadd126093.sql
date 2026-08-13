CREATE TABLE public.journal_trades (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  trade_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_trades TO authenticated;
GRANT ALL ON public.journal_trades TO service_role;

ALTER TABLE public.journal_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own journal trades"
ON public.journal_trades FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX journal_trades_user_date_idx ON public.journal_trades (user_id, trade_date DESC);

CREATE TRIGGER journal_trades_touch_updated_at
BEFORE UPDATE ON public.journal_trades
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
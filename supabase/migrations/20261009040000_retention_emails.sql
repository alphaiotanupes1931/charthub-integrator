ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS daily_profit_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS morning_brief_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scanner_wins_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_scan_done_at timestamptz;

CREATE TABLE IF NOT EXISTS public.daily_profit_emails (
  user_id uuid NOT NULL,
  trading_day text NOT NULL,
  pnl numeric,
  currency text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trading_day)
);
ALTER TABLE public.daily_profit_emails ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.daily_profit_emails TO service_role;

CREATE TABLE IF NOT EXISTS public.retention_emails (
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('morning_brief','scanner_wins')),
  trading_day text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, trading_day)
);
ALTER TABLE public.retention_emails ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.retention_emails TO service_role;

SELECT cron.schedule('trademind-daily-profit-email', '7 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/daily-profit-email',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb) as request_id;
$$);

SELECT cron.schedule('trademind-retention-emails', '4 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/retention-emails',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb) as request_id;
$$);

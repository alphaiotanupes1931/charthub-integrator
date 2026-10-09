ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_profit_email boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.daily_profit_emails (
  user_id uuid NOT NULL,
  trading_day date NOT NULL,
  pnl numeric NOT NULL,
  currency text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trading_day)
);
--> statement-breakpoint
ALTER TABLE public.daily_profit_emails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "own daily profit emails" ON public.daily_profit_emails;
--> statement-breakpoint
CREATE POLICY "own daily profit emails" ON public.daily_profit_emails FOR SELECT TO authenticated USING (auth.uid() = user_id);
--> statement-breakpoint
GRANT SELECT ON public.daily_profit_emails TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.daily_profit_emails TO service_role;
--> statement-breakpoint
SELECT cron.unschedule('daily-profit-email') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-profit-email');
--> statement-breakpoint
SELECT cron.schedule(
  'daily-profit-email',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/daily-profit-email',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

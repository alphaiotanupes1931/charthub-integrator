CREATE TABLE public.scan_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'chart',
  symbol text NOT NULL,
  timeframe text NOT NULL,
  data_feed text,
  ref_price numeric,
  bias text NOT NULL,
  grade text NOT NULL,
  confidence numeric,
  strategy_id text,
  entry numeric,
  stop numeric,
  tp1 numeric,
  tp2 numeric,
  rr text,
  reason text,
  counter_trend boolean,
  htf_bias text,
  methodology_version text,
  entry_model text,
  signal_score_id uuid,
  refused_reason text,
  status text NOT NULL DEFAULT 'open',
  realized_r numeric,
  mae_r numeric,
  mfe_r numeric,
  resolved_at timestamptz,
  taken boolean NOT NULL DEFAULT false,
  taken_at timestamptz
);
CREATE INDEX scan_log_user_created ON public.scan_log (user_id, created_at DESC);
CREATE INDEX scan_log_open ON public.scan_log (status, created_at) WHERE status = 'open';
GRANT SELECT, INSERT, UPDATE ON public.scan_log TO authenticated;
GRANT ALL ON public.scan_log TO service_role;
ALTER TABLE public.scan_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scan log read" ON public.scan_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own scan log insert" ON public.scan_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own scan log update" ON public.scan_log FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

SELECT cron.schedule('trademind-resolve-scan-log', '12 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/resolve-scan-log',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb) as request_id;
$$);
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('trademind-resolve-signals')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trademind-resolve-signals');

SELECT cron.schedule(
  'trademind-resolve-signals',
  '20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/resolve-signals',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
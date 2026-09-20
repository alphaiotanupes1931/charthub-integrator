SELECT cron.unschedule('signal-alerts-tick')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'signal-alerts-tick');

SELECT cron.schedule(
  'signal-alerts-tick',
  '1 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--04400d4f-a117-4def-9b4d-a6d6f9ecad0e.lovable.app/api/public/hooks/signal-alerts-tick',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_XntLWA_hvMlIp7cD88AKoQ_CE4C96Ma"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);

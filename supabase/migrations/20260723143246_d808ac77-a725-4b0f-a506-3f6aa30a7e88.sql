ALTER TABLE public.briefing_prefs ADD COLUMN IF NOT EXISTS discord_webhook_url TEXT;
ALTER TABLE public.briefings ADD COLUMN IF NOT EXISTS delivered_discord BOOLEAN NOT NULL DEFAULT false;
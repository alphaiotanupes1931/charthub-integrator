ALTER TABLE public.user_broker_credentials DROP CONSTRAINT IF EXISTS user_broker_credentials_user_id_broker_key;
ALTER TABLE public.user_broker_credentials ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS user_broker_credentials_user_broker_env_key
  ON public.user_broker_credentials (user_id, broker, env);
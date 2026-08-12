ALTER TABLE public.user_broker_credentials DROP CONSTRAINT IF EXISTS user_broker_credentials_env_check;
ALTER TABLE public.user_broker_credentials
  ADD CONSTRAINT user_broker_credentials_env_check
  CHECK (env IN ('practice', 'live', 'demo'));
CREATE TABLE public.user_broker_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL DEFAULT 'oanda',
  api_key_ciphertext TEXT NOT NULL,
  account_id TEXT,
  env TEXT NOT NULL DEFAULT 'practice' CHECK (env IN ('practice','live')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_broker_credentials TO authenticated;
GRANT ALL ON public.user_broker_credentials TO service_role;

ALTER TABLE public.user_broker_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own broker creds"
  ON public.user_broker_credentials
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_broker_credentials_touch_updated_at
  BEFORE UPDATE ON public.user_broker_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TABLE public.autopilot_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.autopilot_events TO authenticated;
GRANT ALL ON public.autopilot_events TO service_role;
ALTER TABLE public.autopilot_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Traders can read their own autopilot events"
  ON public.autopilot_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX autopilot_events_user_created_idx
  ON public.autopilot_events (user_id, created_at DESC);
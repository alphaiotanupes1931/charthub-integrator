CREATE TABLE public.signal_feed (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  grade text NOT NULL,
  bias text NOT NULL,
  action text NOT NULL,
  entry numeric,
  stop numeric,
  tp1 numeric,
  rr numeric,
  confidence integer,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.signal_feed TO authenticated;
GRANT ALL ON public.signal_feed TO service_role;

ALTER TABLE public.signal_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read the signal feed"
  ON public.signal_feed FOR SELECT TO authenticated USING (true);

CREATE INDEX signal_feed_created_at_idx ON public.signal_feed (created_at DESC);
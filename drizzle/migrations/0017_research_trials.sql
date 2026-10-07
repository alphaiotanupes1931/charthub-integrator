CREATE TABLE public.research_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prereg_id text NOT NULL,
  hypothesis text NOT NULL,
  null_model text NOT NULL,
  primary_outcome text NOT NULL,
  variant text,
  split text,
  comparisons integer NOT NULL DEFAULT 0,
  n integer NOT NULL DEFAULT 0,
  avg_r numeric,
  total_r numeric,
  verdict text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.research_trials TO authenticated;
GRANT ALL ON public.research_trials TO service_role;
ALTER TABLE public.research_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read trials" ON public.research_trials FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins log trials" ON public.research_trials FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
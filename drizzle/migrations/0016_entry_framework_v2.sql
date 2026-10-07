ALTER TABLE public.signal_scores
  ADD COLUMN IF NOT EXISTS entry_model text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS entry_candidates jsonb,
  ADD COLUMN IF NOT EXISTS entry_candidate_r jsonb,
  ADD COLUMN IF NOT EXISTS entry_diff_r numeric;

CREATE TABLE public.rule_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id text NOT NULL,
  tier text NOT NULL,
  test text NOT NULL,
  hypothesis text,
  null_model text,
  n integer NOT NULL DEFAULT 0,
  avg_r numeric,
  total_r numeric,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rule_evidence TO authenticated;
GRANT ALL ON public.rule_evidence TO service_role;
ALTER TABLE public.rule_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read evidence" ON public.rule_evidence FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins log evidence" ON public.rule_evidence FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
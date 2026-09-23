CREATE TABLE public.prescan_question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  level text NOT NULL,
  model_id text,
  chosen_index int NOT NULL,
  correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.prescan_question_attempts TO authenticated;
GRANT ALL ON public.prescan_question_attempts TO service_role;
ALTER TABLE public.prescan_question_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own attempts readable" ON public.prescan_question_attempts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own attempts insertable" ON public.prescan_question_attempts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE INDEX prescan_attempts_user_idx ON public.prescan_question_attempts (user_id, created_at DESC);
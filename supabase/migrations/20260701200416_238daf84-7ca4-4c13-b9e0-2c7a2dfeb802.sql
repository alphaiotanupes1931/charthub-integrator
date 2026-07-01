
CREATE OR REPLACE FUNCTION public.hermes_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.hermes_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ticker TEXT,
  interval TEXT,
  lens TEXT,
  coach TEXT,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  note TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.hermes_lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  topic TEXT NOT NULL,
  lesson TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  source_feedback_id UUID REFERENCES public.hermes_feedback(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hermes_lessons_topic_idx ON public.hermes_lessons (topic);
CREATE INDEX hermes_lessons_user_idx ON public.hermes_lessons (user_id);
CREATE INDEX hermes_feedback_user_idx ON public.hermes_feedback (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_feedback TO authenticated;
GRANT ALL ON public.hermes_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hermes_lessons TO authenticated;
GRANT ALL ON public.hermes_lessons TO service_role;

ALTER TABLE public.hermes_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hermes_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own feedback rw" ON public.hermes_feedback
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "read own or global lessons" ON public.hermes_lessons
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "insert own lessons" ON public.hermes_lessons
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own lessons" ON public.hermes_lessons
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete own lessons" ON public.hermes_lessons
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER hermes_lessons_updated_at
  BEFORE UPDATE ON public.hermes_lessons
  FOR EACH ROW EXECUTE FUNCTION public.hermes_touch_updated_at();

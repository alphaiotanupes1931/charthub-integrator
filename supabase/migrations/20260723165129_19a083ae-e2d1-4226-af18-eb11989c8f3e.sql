
CREATE TABLE public.academy_progress (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  completed JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_module INTEGER,
  last_lesson TEXT,
  quiz_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  tour_done BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.academy_progress TO authenticated;
GRANT ALL ON public.academy_progress TO service_role;

ALTER TABLE public.academy_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own academy progress select" ON public.academy_progress
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own academy progress insert" ON public.academy_progress
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own academy progress update" ON public.academy_progress
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER academy_progress_touch
  BEFORE UPDATE ON public.academy_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

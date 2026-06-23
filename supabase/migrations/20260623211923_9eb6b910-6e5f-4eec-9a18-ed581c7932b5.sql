CREATE TABLE public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

GRANT SELECT, INSERT, UPDATE ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own AI usage"
  ON public.ai_usage FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert their own AI usage"
  ON public.ai_usage FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update their own AI usage"
  ON public.ai_usage FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Atomic increment + cap check. Returns the new count after increment.
-- Raises 'daily_cap_reached' if already at or above the cap.
CREATE OR REPLACE FUNCTION public.bump_ai_usage(_cap INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_today DATE := (now() AT TIME ZONE 'utc')::date;
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO public.ai_usage (user_id, day, count, updated_at)
  VALUES (v_uid, v_today, 1, now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET
    count = public.ai_usage.count + 1,
    updated_at = now()
  WHERE public.ai_usage.count < _cap
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    RAISE EXCEPTION 'daily_cap_reached';
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_ai_usage(INTEGER) TO authenticated;
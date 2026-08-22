-- 1. Feature switches -------------------------------------------------------
CREATE TABLE public.app_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_flags TO authenticated;
GRANT ALL ON public.app_flags TO service_role;

ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read feature flags"
  ON public.app_flags FOR SELECT TO authenticated USING (true);

CREATE TRIGGER app_flags_touch
  BEFORE UPDATE ON public.app_flags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.app_flags (key, enabled, note)
VALUES ('free_tier_enabled', false, 'Permanent free tier: 3 grades/month. Off = previous trial behaviour.');

-- 2. Monthly grade quota ----------------------------------------------------
CREATE TABLE public.free_tier_quota (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  grades_used INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  lifetime_grades INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

GRANT SELECT ON public.free_tier_quota TO authenticated;
GRANT ALL ON public.free_tier_quota TO service_role;

ALTER TABLE public.free_tier_quota ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own quota"
  ON public.free_tier_quota FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER free_tier_quota_touch
  BEFORE UPDATE ON public.free_tier_quota
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Short-lived scan cache (10-minute debounce) ----------------------------
CREATE TABLE public.scan_cache (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cache_key)
);

GRANT SELECT ON public.scan_cache TO authenticated;
GRANT ALL ON public.scan_cache TO service_role;

ALTER TABLE public.scan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own cached scans"
  ON public.scan_cache FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. Helpers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_free_grade(_user_id uuid, _month text, _limit integer, _timezone text DEFAULT 'UTC')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  INSERT INTO public.free_tier_quota (user_id, month, grades_used, timezone, lifetime_grades)
  VALUES (_user_id, _month, 1, COALESCE(_timezone, 'UTC'), 1)
  ON CONFLICT (user_id, month)
  DO UPDATE SET grades_used = public.free_tier_quota.grades_used + 1,
                lifetime_grades = public.free_tier_quota.lifetime_grades + 1,
                timezone = COALESCE(_timezone, public.free_tier_quota.timezone),
                updated_at = now()
  WHERE public.free_tier_quota.grades_used < _limit
  RETURNING grades_used INTO v_used;

  IF v_used IS NULL THEN
    RAISE EXCEPTION 'free_grade_limit_reached';
  END IF;

  RETURN v_used;
END;
$$;

CREATE OR REPLACE FUNCTION public.free_grades_used(_user_id uuid, _month text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT grades_used FROM public.free_tier_quota WHERE user_id = _user_id AND month = _month), 0);
$$;

CREATE OR REPLACE FUNCTION public.admin_set_flag(_key text, _enabled boolean)
RETURNS public.app_flags
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.app_flags;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.app_flags SET enabled = _enabled WHERE key = _key RETURNING * INTO v_row;
  IF v_row.key IS NULL THEN
    RAISE EXCEPTION 'unknown flag';
  END IF;
  RETURN v_row;
END;
$$;
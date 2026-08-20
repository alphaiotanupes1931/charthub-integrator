ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.bump_image_usage(_user_id uuid, _cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'utc')::date;
  v_count INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  INSERT INTO public.ai_usage (user_id, day, count, image_count, updated_at)
  VALUES (_user_id, v_today, 0, 1, now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET image_count = public.ai_usage.image_count + 1, updated_at = now()
  WHERE public.ai_usage.image_count < _cap
  RETURNING image_count INTO v_count;
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'image_cap_reached';
  END IF;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.bump_image_usage(uuid, integer) TO authenticated, service_role;
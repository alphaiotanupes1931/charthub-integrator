
CREATE TABLE public.platform_status (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  level TEXT NOT NULL DEFAULT 'operational' CHECK (level IN ('operational','degraded','down')),
  message TEXT NOT NULL DEFAULT 'No issues have currently been recorded within the platform, nor are we aware of any issues. Security measures up to par.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

GRANT SELECT ON public.platform_status TO authenticated, anon;
GRANT ALL ON public.platform_status TO service_role;

ALTER TABLE public.platform_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read platform status"
  ON public.platform_status FOR SELECT
  USING (true);

INSERT INTO public.platform_status (id, level, message)
VALUES (true, 'operational', 'No issues have currently been recorded within the platform, nor are we aware of any issues. Security measures up to par.')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_platform_status(_level TEXT, _message TEXT)
RETURNS public.platform_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.platform_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF _level NOT IN ('operational','degraded','down') THEN
    RAISE EXCEPTION 'invalid level';
  END IF;
  UPDATE public.platform_status
     SET level = _level, message = _message, updated_at = now(), updated_by = auth.uid()
   WHERE id = true
  RETURNING * INTO _row;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_platform_status(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_status(TEXT, TEXT) TO authenticated;

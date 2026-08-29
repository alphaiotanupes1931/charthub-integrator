-- Ban / unban any account (admin only). Previously missing, so the admin panel's ban button failed.
CREATE OR REPLACE FUNCTION public.admin_set_banned(_user_id uuid, _banned boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _user_id = auth.uid() AND _banned THEN
    RAISE EXCEPTION 'You cannot ban your own account';
  END IF;
  UPDATE public.profiles SET banned = COALESCE(_banned, false) WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;
END;
$$;

-- Force an account to choose a new password at next sign-in.
CREATE OR REPLACE FUNCTION public.admin_force_password_change(_user_id uuid, _required boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.profiles SET must_change_password = COALESCE(_required, true) WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;
END;
$$;

-- Give an account its free monthly signal grades back.
CREATE OR REPLACE FUNCTION public.admin_reset_free_quota(_user_id uuid, _month text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.free_tier_quota SET grades_used = 0, updated_at = now()
   WHERE user_id = _user_id AND month = _month;
END;
$$;
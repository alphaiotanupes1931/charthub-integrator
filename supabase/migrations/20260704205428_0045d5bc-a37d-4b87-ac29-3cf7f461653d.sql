
-- Rewrite bump_ai_usage to accept explicit user id (service_role has no auth.uid())
DROP FUNCTION IF EXISTS public.bump_ai_usage(integer);
CREATE OR REPLACE FUNCTION public.bump_ai_usage(_user_id uuid, _cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'utc')::date;
  v_count INTEGER;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  INSERT INTO public.ai_usage (user_id, day, count, updated_at)
  VALUES (_user_id, v_today, 1, now())
  ON CONFLICT (user_id, day)
  DO UPDATE SET count = public.ai_usage.count + 1, updated_at = now()
  WHERE public.ai_usage.count < _cap
  RETURNING count INTO v_count;
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'daily_cap_reached';
  END IF;
  RETURN v_count;
END;
$$;

-- Rewrite redeem_invite to accept explicit user id
DROP FUNCTION IF EXISTS public.redeem_invite(text);
CREATE OR REPLACE FUNCTION public.redeem_invite(_user_id uuid, _code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := _user_id;
  v_invite public.trader_invites;
  v_a uuid;
  v_b uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO v_invite FROM public.trader_invites WHERE code = _code LIMIT 1;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_invite.inviter_id = v_uid THEN
    RAISE EXCEPTION 'That''s your own invite link';
  END IF;
  IF v_invite.accepted_by IS NULL THEN
    UPDATE public.trader_invites
       SET accepted_by = v_uid, accepted_at = now()
     WHERE id = v_invite.id;
  END IF;
  IF v_invite.inviter_id < v_uid THEN
    v_a := v_invite.inviter_id; v_b := v_uid;
  ELSE
    v_a := v_uid; v_b := v_invite.inviter_id;
  END IF;
  INSERT INTO public.trader_connections (user_a, user_b)
    VALUES (v_a, v_b)
    ON CONFLICT (user_a, user_b) DO NOTHING;
  RETURN v_invite.inviter_id;
END;
$$;

-- Lock down EXECUTE on all SECURITY DEFINER functions: only service_role (used by
-- trusted server code) can call them. handle_new_user is a trigger and needs no grants.
REVOKE ALL ON FUNCTION public.admin_referral_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_platform_status(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_users_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_ai_usage(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_invite(uuid, text) FROM PUBLIC;

DO $$
DECLARE
  fn text;
BEGIN
  FOR fn IN
    SELECT unnest(ARRAY[
      'public.admin_referral_stats()',
      'public.admin_set_platform_status(text, text)',
      'public.admin_users_overview()',
      'public.bump_ai_usage(uuid, integer)',
      'public.handle_new_user()',
      'public.has_active_subscription(uuid)',
      'public.has_role(uuid, app_role)',
      'public.redeem_invite(uuid, text)'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- Tighten trader_invites UPDATE: only the accepted_by / accepted_at columns may be
-- modified by an acceptor, so unrelated fields (code, note, inviter_id, created_at, id)
-- cannot be tampered with. The inviter themselves retains unrestricted updates
-- (there is no other UPDATE policy for them, so this trigger doesn't restrict what
-- doesn't already exist).
DROP POLICY IF EXISTS "acceptor updates invite" ON public.trader_invites;

CREATE POLICY "acceptor updates invite" ON public.trader_invites
FOR UPDATE
TO authenticated
USING (accepted_by IS NULL AND auth.uid() IS NOT NULL AND auth.uid() <> inviter_id)
WITH CHECK (auth.uid() = accepted_by);

CREATE OR REPLACE FUNCTION public.trader_invites_prevent_tamper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.inviter_id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.inviter_id IS DISTINCT FROM OLD.inviter_id
       OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only accepted_by and accepted_at may be modified by an acceptor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trader_invites_prevent_tamper_trg ON public.trader_invites;
CREATE TRIGGER trader_invites_prevent_tamper_trg
BEFORE UPDATE ON public.trader_invites
FOR EACH ROW EXECUTE FUNCTION public.trader_invites_prevent_tamper();

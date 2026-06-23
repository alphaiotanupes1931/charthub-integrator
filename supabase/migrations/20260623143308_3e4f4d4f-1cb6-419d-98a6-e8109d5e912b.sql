
-- Drop overly broad SELECT policy that exposed every invite to all signed-in users
DROP POLICY IF EXISTS "any auth can lookup invite" ON public.trader_invites;

-- SECURITY DEFINER RPC: redeem an invite by code without granting broad SELECT
CREATE OR REPLACE FUNCTION public.redeem_invite(_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
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

REVOKE ALL ON FUNCTION public.redeem_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated;

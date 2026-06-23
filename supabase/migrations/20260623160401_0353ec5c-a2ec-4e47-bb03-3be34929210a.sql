
-- Revoke broad execute on all SECURITY DEFINER functions, then re-grant minimally.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_referral_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_users_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Keep authenticated execute only where required (RLS policies + admin RPCs gated internally by has_role).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated;

DROP POLICY IF EXISTS "read connected profiles" ON public.profiles;

REVOKE EXECUTE ON FUNCTION public.admin_set_ai_model_pref(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_users_overview() FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_expired_chat_threads() FROM anon;

REVOKE EXECUTE ON FUNCTION public.admin_ai_cost_per_user(integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_ai_cost_summary(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_force_password_change(uuid, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_referral_stats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reset_free_quota(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_ai_model_pref(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_banned(uuid, boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_flag(text, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_platform_status(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_usage_today() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_users_overview() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.archive_expired_chat_threads() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.admin_ai_cost_per_user(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_cost_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_password_change(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_free_quota(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_model_pref(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_banned(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_flag(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_status(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO authenticated;
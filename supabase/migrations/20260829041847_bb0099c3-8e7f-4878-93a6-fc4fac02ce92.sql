REVOKE EXECUTE ON FUNCTION public.admin_set_banned(uuid, boolean, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_force_password_change(uuid, boolean) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_reset_free_quota(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_set_banned(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_password_change(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_free_quota(uuid, text) TO authenticated;
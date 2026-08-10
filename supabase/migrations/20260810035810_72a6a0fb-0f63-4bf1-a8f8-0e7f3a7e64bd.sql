REVOKE EXECUTE ON FUNCTION public.admin_ai_cost_summary(INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_ai_cost_per_user(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_cost_summary(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ai_cost_per_user(INTEGER, INTEGER) TO authenticated, service_role;
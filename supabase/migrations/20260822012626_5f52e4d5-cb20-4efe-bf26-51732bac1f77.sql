REVOKE ALL ON FUNCTION public.consume_free_grade(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.free_grades_used(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_free_grade(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.free_grades_used(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_set_flag(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_flag(text, boolean) TO authenticated, service_role;
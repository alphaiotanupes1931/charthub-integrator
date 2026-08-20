REVOKE EXECUTE ON FUNCTION public.bump_image_usage(uuid, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_image_usage(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bump_image_usage(uuid, integer) FROM PUBLIC;
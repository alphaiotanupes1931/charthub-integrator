
-- 1. Extend profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT false;

-- 2. App roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. has_role security-definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- 4. Admin-only stats RPC (referral source counts)
CREATE OR REPLACE FUNCTION public.admin_referral_stats()
RETURNS TABLE(source TEXT, count BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT COALESCE(p.referral_source, 'Unknown') AS source, COUNT(*)::BIGINT
  FROM public.profiles p
  GROUP BY COALESCE(p.referral_source, 'Unknown')
  ORDER BY 2 DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_referral_stats() TO authenticated;

-- 5. Admin users list RPC
CREATE OR REPLACE FUNCTION public.admin_users_overview()
RETURNS TABLE(id UUID, email TEXT, display_name TEXT, referral_source TEXT, onboarded BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.display_name, p.referral_source, p.onboarded, p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO authenticated;

-- 6. Ensure profile auto-create trigger exists (handle_new_user already defined)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. Seed Terell as admin + set name
DO $$
DECLARE u_id UUID;
BEGIN
  SELECT id INTO u_id FROM auth.users WHERE email = 'terellebony@gmail.com' LIMIT 1;
  IF u_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, display_name, onboarded)
    VALUES (u_id, 'terellebony@gmail.com', 'Terell Reed', true)
    ON CONFLICT (id) DO UPDATE SET display_name = 'Terell Reed', onboarded = true;
    INSERT INTO public.user_roles (user_id, role) VALUES (u_id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

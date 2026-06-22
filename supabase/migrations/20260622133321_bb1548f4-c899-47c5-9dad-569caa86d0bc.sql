-- Add user_id columns (nullable so existing rows orphan cleanly)
ALTER TABLE public.chat_threads  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS chat_threads_user_id_idx  ON public.chat_threads(user_id);
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx ON public.chat_messages(user_id);

-- Drop old "anyone can ..." policies
DROP POLICY IF EXISTS "anyone can read threads"   ON public.chat_threads;
DROP POLICY IF EXISTS "anyone can insert threads" ON public.chat_threads;
DROP POLICY IF EXISTS "anyone can update threads" ON public.chat_threads;
DROP POLICY IF EXISTS "anyone can delete threads" ON public.chat_threads;

DROP POLICY IF EXISTS "anyone can read messages"   ON public.chat_messages;
DROP POLICY IF EXISTS "anyone can insert messages" ON public.chat_messages;
DROP POLICY IF EXISTS "anyone can delete messages" ON public.chat_messages;

-- Revoke prior public grants
REVOKE ALL ON public.chat_threads  FROM anon;
REVOKE ALL ON public.chat_messages FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_threads  TO service_role;
GRANT ALL ON public.chat_messages TO service_role;

-- New per-user policies (orphaned NULL rows stay invisible)
CREATE POLICY "users read own threads"   ON public.chat_threads  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own threads" ON public.chat_threads  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own threads" ON public.chat_threads  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own threads" ON public.chat_threads  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "users read own messages"   ON public.chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own messages" ON public.chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own profile"   ON public.profiles;
DROP POLICY IF EXISTS "users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "users insert own profile" ON public.profiles;
CREATE POLICY "users read own profile"   ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger for profiles
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
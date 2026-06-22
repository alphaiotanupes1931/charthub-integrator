
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_id_override TEXT;

CREATE TABLE IF NOT EXISTS public.trader_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  note TEXT,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trader_invites TO authenticated;
GRANT ALL ON public.trader_invites TO service_role;
ALTER TABLE public.trader_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inviter reads own invites" ON public.trader_invites;
CREATE POLICY "inviter reads own invites" ON public.trader_invites
  FOR SELECT TO authenticated USING (auth.uid() = inviter_id);
DROP POLICY IF EXISTS "inviter inserts own invites" ON public.trader_invites;
CREATE POLICY "inviter inserts own invites" ON public.trader_invites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = inviter_id);
DROP POLICY IF EXISTS "inviter deletes own invites" ON public.trader_invites;
CREATE POLICY "inviter deletes own invites" ON public.trader_invites
  FOR DELETE TO authenticated USING (auth.uid() = inviter_id);
DROP POLICY IF EXISTS "any auth can lookup invite" ON public.trader_invites;
CREATE POLICY "any auth can lookup invite" ON public.trader_invites
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "acceptor updates invite" ON public.trader_invites;
CREATE POLICY "acceptor updates invite" ON public.trader_invites
  FOR UPDATE TO authenticated
  USING (accepted_by IS NULL OR auth.uid() = accepted_by)
  WITH CHECK (auth.uid() = accepted_by);

CREATE TABLE IF NOT EXISTS public.trader_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a <> user_b)
);
GRANT SELECT, INSERT, DELETE ON public.trader_connections TO authenticated;
GRANT ALL ON public.trader_connections TO service_role;
ALTER TABLE public.trader_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read connection" ON public.trader_connections;
CREATE POLICY "members read connection" ON public.trader_connections
  FOR SELECT TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);
DROP POLICY IF EXISTS "members insert connection" ON public.trader_connections;
CREATE POLICY "members insert connection" ON public.trader_connections
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);
DROP POLICY IF EXISTS "members delete connection" ON public.trader_connections;
CREATE POLICY "members delete connection" ON public.trader_connections
  FOR DELETE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS "read connected profiles" ON public.profiles;
CREATE POLICY "read connected profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trader_connections c
      WHERE (c.user_a = auth.uid() AND c.user_b = profiles.id)
         OR (c.user_b = auth.uid() AND c.user_a = profiles.id)
    )
  );


-- 1) Lock trader_connections: no direct inserts; only via redeem_invite (SECURITY DEFINER)
DROP POLICY IF EXISTS "members insert connection" ON public.trader_connections;
-- Keep SELECT for connected members if it exists; do not add a new INSERT policy.

-- 2) chat_messages: enforce user_id NOT NULL
DELETE FROM public.chat_messages WHERE user_id IS NULL;
ALTER TABLE public.chat_messages ALTER COLUMN user_id SET NOT NULL;

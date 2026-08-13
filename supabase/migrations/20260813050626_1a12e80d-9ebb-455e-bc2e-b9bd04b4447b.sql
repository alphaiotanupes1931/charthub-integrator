CREATE TABLE public.ai_budget (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  monthly_budget_usd NUMERIC NOT NULL DEFAULT 100,
  low_threshold_pct INTEGER NOT NULL DEFAULT 20,
  provider_status TEXT NOT NULL DEFAULT 'unknown',
  provider_message TEXT,
  checked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.ai_budget TO authenticated;
GRANT ALL ON public.ai_budget TO service_role;

ALTER TABLE public.ai_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ai budget" ON public.ai_budget
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ai budget" ON public.ai_budget
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_budget_touch BEFORE UPDATE ON public.ai_budget
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.ai_budget (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'ticket' CHECK (kind IN ('ticket','feedback')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  reply_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can submit support tickets" ON public.support_tickets
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own tickets" ON public.support_tickets
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tickets" ON public.support_tickets
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX support_tickets_created_idx ON public.support_tickets (created_at DESC);

CREATE TRIGGER support_tickets_touch BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
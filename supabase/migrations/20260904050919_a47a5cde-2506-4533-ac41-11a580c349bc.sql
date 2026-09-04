CREATE TABLE public.marketing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text NOT NULL DEFAULT 'landing',
  ref text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  drip_stage integer NOT NULL DEFAULT 0,
  next_send_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX marketing_leads_email_key ON public.marketing_leads (lower(email));
CREATE INDEX marketing_leads_due_idx ON public.marketing_leads (next_send_at) WHERE unsubscribed_at IS NULL;

GRANT ALL ON public.marketing_leads TO service_role;

ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read marketing leads" ON public.marketing_leads
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER marketing_leads_touch
  BEFORE UPDATE ON public.marketing_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
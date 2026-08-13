CREATE TABLE public.manual_revenue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  monthly_amount_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_revenue TO authenticated;
GRANT ALL ON public.manual_revenue TO service_role;

ALTER TABLE public.manual_revenue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view manual revenue"
  ON public.manual_revenue FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert manual revenue"
  ON public.manual_revenue FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update manual revenue"
  ON public.manual_revenue FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete manual revenue"
  ON public.manual_revenue FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER manual_revenue_touch_updated_at
  BEFORE UPDATE ON public.manual_revenue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.manual_revenue (name, email, monthly_amount_cents, note)
VALUES
  ('Terrell Reed', NULL, 5000, 'Manual entry, pending Stripe'),
  ('Jehan Jackson', NULL, 10000, 'Manual entry, pending Stripe');
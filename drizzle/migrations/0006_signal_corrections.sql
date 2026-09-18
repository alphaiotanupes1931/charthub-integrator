CREATE TABLE public.signal_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES public.signal_scores(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.signal_corrections IS 'Dated audit trail of any change to an already-resolved signal. The record is append-only, so a verdict is never quietly overwritten: the old value stays here with the reason it changed.';

CREATE INDEX signal_corrections_signal_idx ON public.signal_corrections (signal_id);
CREATE INDEX signal_corrections_at_idx ON public.signal_corrections (corrected_at DESC);

GRANT SELECT ON public.signal_corrections TO anon;
GRANT SELECT ON public.signal_corrections TO authenticated;
GRANT ALL ON public.signal_corrections TO service_role;

ALTER TABLE public.signal_corrections ENABLE ROW LEVEL SECURITY;

-- Corrections are part of the public track record: readable by everyone, written
-- only by the server-side resolver.
CREATE POLICY "Corrections are public" ON public.signal_corrections FOR SELECT USING (true);
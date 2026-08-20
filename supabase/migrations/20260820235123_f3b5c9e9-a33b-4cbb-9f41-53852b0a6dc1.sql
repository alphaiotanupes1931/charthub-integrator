ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS sentiment TEXT;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_sentiment_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_sentiment_check
  CHECK (sentiment IS NULL OR sentiment IN ('good','neutral','bad'));
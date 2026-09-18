-- Append-only integrity: a fingerprint of the terms the signal was filed with.
-- Recomputing it later and comparing proves no entry, stop, target, direction or
-- grade was edited after the fact.
ALTER TABLE public.signal_scores ADD COLUMN IF NOT EXISTS filed_hash text;
CREATE INDEX IF NOT EXISTS signal_scores_filed_hash_idx ON public.signal_scores (filed_hash);
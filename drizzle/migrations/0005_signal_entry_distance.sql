ALTER TABLE public.signal_scores ADD COLUMN IF NOT EXISTS entry_distance_r NUMERIC;

COMMENT ON COLUMN public.signal_scores.entry_distance_r IS 'How far price sat past the planned entry, in planned R, at the moment the signal was filed. Null for rows filed before the staleness guard existed; unrecoverable for those.';
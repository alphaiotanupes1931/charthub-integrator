-- Where a filed signal came from. Our own engine is the only source published on
-- the public record; third-party signals are filed and resolved on identical terms
-- but kept out of the published aggregates unless deliberately included.
ALTER TABLE public.signal_scores ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'engine';
CREATE INDEX IF NOT EXISTS signal_scores_source_idx ON public.signal_scores (source);

-- API keys that let an outside tool (TradingView, n8n, a user's own script) file a
-- signal into the record on the same terms as ours.
CREATE TABLE IF NOT EXISTS public.signal_inbound_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'Inbound signals',
  token text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'webhook',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_inbound_keys TO authenticated;
GRANT ALL ON public.signal_inbound_keys TO service_role;

ALTER TABLE public.signal_inbound_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their inbound keys"
  ON public.signal_inbound_keys FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners create their inbound keys"
  ON public.signal_inbound_keys FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners update their inbound keys"
  ON public.signal_inbound_keys FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners delete their inbound keys"
  ON public.signal_inbound_keys FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS signal_inbound_keys_user_idx ON public.signal_inbound_keys (user_id);
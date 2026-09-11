CREATE TABLE public.scanner_methodology_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  summary text NOT NULL,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scanner_methodology_versions TO authenticated;
GRANT ALL ON public.scanner_methodology_versions TO service_role;
ALTER TABLE public.scanner_methodology_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage scanner methodology" ON public.scanner_methodology_versions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_scanner_methodology_versions BEFORE UPDATE ON public.scanner_methodology_versions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.scanner_expert_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  methodology_version text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  replay_case jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','needs_changes')),
  corrected_levels jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  promoted_to_fixture boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scanner_expert_reviews TO authenticated;
GRANT ALL ON public.scanner_expert_reviews TO service_role;
ALTER TABLE public.scanner_expert_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage expert reviews" ON public.scanner_expert_reviews FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_scanner_expert_reviews BEFORE UPDATE ON public.scanner_expert_reviews FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.command_board_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL,
  owner text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','building','testing','approved','blocked')),
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.command_board_items TO authenticated;
GRANT ALL ON public.command_board_items TO service_role;
ALTER TABLE public.command_board_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage command board" ON public.command_board_items FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER touch_command_board_items BEFORE UPDATE ON public.command_board_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.signal_scores ADD COLUMN methodology_version text NOT NULL DEFAULT '2026.09-v1';

INSERT INTO public.scanner_methodology_versions (version, status, summary, rules, activated_at)
VALUES (
  '2026.09-v1',
  'active',
  'Top-down structure-first scanner: Daily and 4H direction, fresh 1H order block, style-specific lower-timeframe confirmation, structural stop and targets, and measured grade caps.',
  jsonb_build_object(
    'direction', 'Daily and 4H establish direction and current trend',
    'entry', 'Fresh displacement-backed 1H order blocks outrank gaps and bare levels',
    'confirmation', 'Scalp uses 5m displacement, intraday uses 15m confirmation, swing uses 1H structure break',
    'stop', 'Beyond the invalidating zone and recent swing with an ATR buffer',
    'targets', 'Nearest opposing structure on the selected execution horizon',
    'grade', 'A requires high-quality aligned 1H order block and all safety gates',
    'wait', 'Unconfirmed setups preserve levels but remain not triggered'
  ),
  now()
)
ON CONFLICT (version) DO NOTHING;
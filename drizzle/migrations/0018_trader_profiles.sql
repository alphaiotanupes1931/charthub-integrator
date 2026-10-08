CREATE TABLE public.trader_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('public_quiz','onboarding','self_select')),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  trader_type text NOT NULL,
  recommended_coach text NOT NULL,
  coach_tone text NOT NULL,
  recommended_strategies text[] NOT NULL DEFAULT '{}',
  risk_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  chosen_coach text,
  chosen_strategies text[],
  chosen_risk jsonb,
  accepted boolean,
  ref text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trader_profiles_user_created ON public.trader_profiles (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.trader_profiles TO authenticated;
GRANT ALL ON public.trader_profiles TO service_role;
ALTER TABLE public.trader_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profiles read" ON public.trader_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own profiles insert" ON public.trader_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.quiz_drafts (
  code text PRIMARY KEY,
  answers jsonb NOT NULL,
  trader_type text NOT NULL,
  ref text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_by uuid,
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.quiz_drafts TO service_role;
ALTER TABLE public.quiz_drafts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.quiz_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  trader_type text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ref text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  ghl_status text NOT NULL DEFAULT 'pending',
  ghl_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.quiz_leads TO service_role;
ALTER TABLE public.quiz_leads ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_coach text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_strategy text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trader_type_prompt_dismissed_at timestamptz;
## Plans (from landing page)
- Basic — $49/mo
- Pro — $97/mo
- Elite — $197/mo
- 7-day free trial for every new signup
- Admins bypass paywall
- Monthly recurring, cancel anytime via Stripe portal

## Flow
1. New user signs up → onboarding → `/pricing` (blocked from `/dashboard`)
2. Picks tier → Stripe Checkout (7-day trial, card required) → returns to `/dashboard`
3. Stripe webhook writes `subscriptions` row → gate lets them in
4. If payment fails / cancels → status flips to `past_due` or `canceled` → next page load redirects to `/pricing` with banner: "Your subscription is inactive. Reactivate to keep access."
5. Settings → "Manage billing" opens Stripe Customer Portal (change plan, cancel, update card)
6. Admins bypass the gate entirely

## Existing subscribers
Once you drop your Stripe secret key in, I'll add an admin page (`/admin/subscribers`) that pulls the live list of active/trialing subscribers straight from Stripe (email, plan, MRR, status, next renewal). Anyone in that list is auto-granted access on their next login — I match by email against `auth.users`.

## What I need from you
- **STRIPE_SECRET_KEY** — your live secret key (`sk_live_...`). I'll request it via secure secret form.
- **STRIPE_WEBHOOK_SECRET** — I'll give you the webhook URL to paste into Stripe Dashboard → Developers → Webhooks, then you paste back the signing secret.
- **Stripe Price IDs** — after you create the 3 monthly prices in Stripe ($49/$97/$197), paste the `price_...` IDs. Or I can create them programmatically once the secret key is in.

## Technical build

**Database (migration)**
```
subscriptions (
  user_id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  tier text,                              -- 'basic' | 'pro' | 'elite'
  status text,                            -- 'trialing'|'active'|'past_due'|'canceled'|'incomplete'
  current_period_end timestamptz,
  trial_end timestamptz,
  updated_at timestamptz default now()
)
```
+ GRANTs, RLS (user reads own row; service_role writes)
+ SECURITY DEFINER `has_active_subscription(uuid)` helper

**Server functions** (`src/lib/billing.functions.ts`)
- `createCheckoutSession({ tier })` — auth required, creates/reuses customer, 7-day trial, returns URL
- `createPortalSession()` — auth required, returns Stripe portal URL
- `getMySubscription()` — reads row for gate
- `listSubscribers()` — admin-only, pulls live list from Stripe API

**Server route**
- `src/routes/api.public.stripe-webhook.ts` — verifies signature, handles `customer.subscription.created|updated|deleted`, `invoice.payment_failed`, upserts subscriptions row

**Gate**
- Extend `src/routes/_app.tsx` `beforeLoad`: after profile check, if `!isAdmin && status NOT IN ('active','trialing')` and pathname !== `/pricing`, redirect to `/pricing`

**UI**
- `src/routes/_app.pricing.tsx` — 3 cards, "Start 7-day free trial" button per plan → checkout
- Settings → "Manage billing" button → portal
- `src/routes/_app.admin.subscribers.tsx` — admin table of Stripe subscribers

**Landing page CTA** stays the same but "Get Started" now routes into signup → trial pick.

## Order of operations
1. You approve this plan
2. I request `STRIPE_SECRET_KEY` via secure form
3. I create DB migration + all code
4. I give you the webhook URL to configure in Stripe Dashboard
5. You paste `STRIPE_WEBHOOK_SECRET` back
6. I create the 3 Prices in Stripe programmatically (or you paste IDs)
7. I pull your existing subscriber list and show it to you

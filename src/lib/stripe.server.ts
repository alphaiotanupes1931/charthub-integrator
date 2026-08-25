// Server-only Stripe helper module.
import Stripe from "stripe";

export type PlanTier = "basic" | "pro" | "elite";

export const PLANS: Record<
  PlanTier,
  { name: string; amount: number; lookupKey: string }
> = {
  basic: { name: "Basic", amount: 4900, lookupKey: "trademind_basic_monthly_v1" },
  pro: { name: "Pro", amount: 9700, lookupKey: "trademind_pro_monthly_v1" },
  elite: { name: "Elite", amount: 19700, lookupKey: "trademind_elite_monthly_v1" },
};

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  _stripe = new Stripe(key);
  return _stripe;
}

let _productId: string | null = null;
async function ensureProduct(stripe: Stripe): Promise<string> {
  if (_productId) return _productId;
  const existing = await stripe.products.search({
    query: `active:'true' AND metadata['app']:'trademind'`,
    limit: 1,
  });
  if (existing.data.length) {
    _productId = existing.data[0].id;
    return _productId;
  }
  const created = await stripe.products.create({
    name: "TradeMind Subscription",
    metadata: { app: "trademind" },
  });
  _productId = created.id;
  return _productId;
}

const priceCache: Partial<Record<PlanTier, string>> = {};

/** A price is only usable if it is USD, monthly, and matches the published amount. */
function priceMatchesPlan(price: Stripe.Price, plan: { amount: number }): boolean {
  return (
    price.active === true &&
    price.currency === "usd" &&
    price.unit_amount === plan.amount &&
    price.recurring?.interval === "month" &&
    (price.recurring?.interval_count ?? 1) === 1
  );
}

async function createPlanPrice(stripe: Stripe, tier: PlanTier): Promise<string> {
  const plan = PLANS[tier];
  const productId = await ensureProduct(stripe);
  const created = await stripe.prices.create({
    unit_amount: plan.amount,
    currency: "usd",
    recurring: { interval: "month" },
    product: productId,
    lookup_key: plan.lookupKey,
    // Take over the lookup key from any stale price that still holds it.
    transfer_lookup_key: true,
    metadata: { tier, app: "trademind" },
  });
  return created.id;
}

export async function getPriceIdForTier(tier: PlanTier): Promise<string> {
  if (priceCache[tier]) return priceCache[tier]!;
  const stripe = getStripe();
  const plan = PLANS[tier];

  const list = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 10,
  });
  const good = list.data.find((p) => priceMatchesPlan(p, plan));
  if (good) {
    priceCache[tier] = good.id;
    return good.id;
  }

  // Wrong currency or stale amount on the existing price: archive it so it can
  // never be presented at checkout again, then mint a correct USD price.
  for (const stale of list.data) {
    try {
      await stripe.prices.update(stale.id, { active: false });
    } catch {
      /* ignore: archiving is best effort */
    }
  }

  const id = await createPlanPrice(stripe, tier);
  priceCache[tier] = id;
  return id;
}

/**
 * Reconcile every tier's Stripe price with the amounts shown on /pricing.
 * Safe to run repeatedly: correct prices are left untouched.
 */
export async function syncPlanPrices(): Promise<
  Array<{ tier: PlanTier; priceId: string; amount: number; currency: string; action: "kept" | "recreated" }>
> {
  const stripe = getStripe();
  const out: Array<{
    tier: PlanTier;
    priceId: string;
    amount: number;
    currency: string;
    action: "kept" | "recreated";
  }> = [];

  for (const tier of Object.keys(PLANS) as PlanTier[]) {
    const plan = PLANS[tier];
    const list = await stripe.prices.list({ lookup_keys: [plan.lookupKey], active: true, limit: 10 });
    const good = list.data.find((p) => priceMatchesPlan(p, plan));
    if (good) {
      priceCache[tier] = good.id;
      out.push({ tier, priceId: good.id, amount: plan.amount, currency: "usd", action: "kept" });
      continue;
    }
    for (const stale of list.data) {
      try {
        await stripe.prices.update(stale.id, { active: false });
      } catch {
        /* ignore */
      }
    }
    const id = await createPlanPrice(stripe, tier);
    priceCache[tier] = id;
    out.push({ tier, priceId: id, amount: plan.amount, currency: "usd", action: "recreated" });
  }

  return out;
}


export function tierFromPrice(price: Stripe.Price | null | undefined): PlanTier | null {
  const key = price?.lookup_key ?? null;
  if (!key) return null;
  for (const t of Object.keys(PLANS) as PlanTier[]) {
    if (PLANS[t].lookupKey === key) return t;
  }
  return null;
}

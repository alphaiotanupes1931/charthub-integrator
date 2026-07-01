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
  _stripe = new Stripe(key, { apiVersion: "2024-11-20.acacia" as Stripe.LatestApiVersion });
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

export async function getPriceIdForTier(tier: PlanTier): Promise<string> {
  if (priceCache[tier]) return priceCache[tier]!;
  const stripe = getStripe();
  const plan = PLANS[tier];

  const list = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    active: true,
    limit: 1,
  });
  if (list.data.length) {
    priceCache[tier] = list.data[0].id;
    return list.data[0].id;
  }

  const productId = await ensureProduct(stripe);
  const created = await stripe.prices.create({
    unit_amount: plan.amount,
    currency: "usd",
    recurring: { interval: "month" },
    product: productId,
    lookup_key: plan.lookupKey,
    metadata: { tier, app: "trademind" },
  });
  priceCache[tier] = created.id;
  return created.id;
}

export function tierFromPrice(price: Stripe.Price | null | undefined): PlanTier | null {
  const key = price?.lookup_key ?? null;
  if (!key) return null;
  for (const t of Object.keys(PLANS) as PlanTier[]) {
    if (PLANS[t].lookupKey === key) return t;
  }
  return null;
}

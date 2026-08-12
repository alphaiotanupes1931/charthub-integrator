// Server-only TradeLocker public API helpers.
// TradeLocker is one of the few retail platforms with a real credential login
// (email + password + server), so "connect your broker" can actually log in
// instead of asking for a hand-generated API token.
// Credentials are encrypted at rest; the JWT is fetched fresh per request.

export type TLEnv = "demo" | "live";

export function tlBase(env: TLEnv): string {
  return env === "live"
    ? "https://live.tradelocker.com/backend-api"
    : "https://demo.tradelocker.com/backend-api";
}

export type TLAccount = {
  id: string | number;
  accNum?: string | number;
  name?: string;
  accountBalance?: number;
  currency?: string;
  status?: string;
};

export async function tlFetch<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "errmsg" in body
        ? String((body as { errmsg?: unknown }).errmsg)
        : typeof body === "string" && body
          ? body.slice(0, 240)
          : `HTTP ${res.status}`;
    throw new Error(`${label}: ${msg}`);
  }
  return body as T;
}

export async function tlLogin(creds: {
  email: string;
  password: string;
  server: string;
  env: TLEnv;
}): Promise<string> {
  const auth = await tlFetch<{ accessToken?: string }>(
    `${tlBase(creds.env)}/auth/jwt/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password, server: creds.server }),
    },
    "TradeLocker login failed",
  );
  if (!auth.accessToken) throw new Error("TradeLocker did not return an access token");
  return auth.accessToken;
}

export async function tlAccounts(env: TLEnv, token: string): Promise<TLAccount[]> {
  const resp = await tlFetch<{ accounts?: TLAccount[] }>(
    `${tlBase(env)}/auth/jwt/all-accounts`,
    { headers: { Authorization: `Bearer ${token}` } },
    "Fetching TradeLocker accounts failed",
  );
  return resp.accounts ?? [];
}

export type StoredTL = { email: string; password: string; server: string; env: TLEnv; accountId: string | null };

/** Load and decrypt the saved TradeLocker login for a user, if any. */
export async function loadTradeLockerCreds(userId: string): Promise<StoredTL | null> {
  const { decryptSecret } = await import("@/lib/broker-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("api_key_ciphertext, account_id, env, is_active, updated_at")
    .eq("user_id", userId)
    .eq("broker", "tradelocker")
    .order("is_active", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0];
  if (!row) return null;
  let parsed: { email?: string; password?: string; server?: string };
  try {
    parsed = JSON.parse(decryptSecret(row.api_key_ciphertext as string));
  } catch {
    return null;
  }
  if (!parsed.email || !parsed.password || !parsed.server) return null;
  return {
    email: parsed.email,
    password: parsed.password,
    server: parsed.server,
    env: (row.env as string) === "live" ? "live" : "demo",
    accountId: (row.account_id as string | null) ?? null,
  };
}

/** Authenticated TradeLocker session for the user: token + accounts + chosen account. */
export async function tlSession(userId: string) {
  const creds = await loadTradeLockerCreds(userId);
  if (!creds) return null;
  const token = await tlLogin(creds);
  const accounts = await tlAccounts(creds.env, token);
  const account =
    accounts.find(
      (a) => String(a.id) === String(creds.accountId) || String(a.accNum) === String(creds.accountId),
    ) ?? accounts[0];
  return { creds, token, accounts, account };
}

export function tlHeaders(token: string, account: TLAccount): Record<string, string> {
  return { Authorization: `Bearer ${token}`, accNum: String(account.accNum ?? account.id) };
}

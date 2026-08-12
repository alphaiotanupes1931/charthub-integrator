// Server-only Alpaca OAuth + trading helpers. Never import from browser code.
import { createHmac, timingSafeEqual } from "node:crypto";

const AUTHORIZE_URL = "https://app.alpaca.markets/oauth/authorize";
const TOKEN_URL = "https://api.alpaca.markets/oauth/token";
const LIVE_API = "https://api.alpaca.markets";
const PAPER_API = "https://paper-api.alpaca.markets";

export type AlpacaEnv = "live" | "practice";

export function alpacaClient() {
  const clientId = process.env.ALPACA_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ALPACA_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Alpaca one-click login is not configured yet. The Alpaca OAuth client ID and secret still need to be saved.",
    );
  }
  return { clientId, clientSecret };
}

function stateKey(): string {
  const raw = process.env.BROKER_CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("BROKER_CREDENTIALS_ENCRYPTION_KEY is not set");
  return raw;
}

/** Signed, short-lived CSRF state bound to the signed-in user. */
export function signState(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", stateKey()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyState(state: string, userId: string): boolean {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return false;
    const [uid, ts, sig] = parts;
    if (uid !== userId) return false;
    if (Date.now() - Number(ts) > 15 * 60 * 1000) return false;
    const expected = createHmac("sha256", stateKey()).update(`${uid}.${ts}`).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const ALLOWED_ORIGIN_SUFFIXES = [".lovable.app", "trademindaicoach.com", "localhost:8080"];

export function redirectUriFor(origin: string): string {
  const explicit = process.env.ALPACA_REDIRECT_URI;
  if (explicit) return explicit;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new Error("Invalid origin for the Alpaca redirect");
  }
  if (!ALLOWED_ORIGIN_SUFFIXES.some((s) => host === s || host.endsWith(s))) {
    throw new Error("This site is not allowed to start an Alpaca login");
  }
  return `${origin.replace(/\/$/, "")}/broker/alpaca/callback`;
}

export function authorizeUrl(origin: string, userId: string): string {
  const { clientId } = alpacaClient();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUriFor(origin));
  url.searchParams.set("scope", "account:write trading data");
  url.searchParams.set("state", signState(userId));
  return url.toString();
}

export async function exchangeCode(code: string, origin: string): Promise<string> {
  const { clientId, clientSecret } = alpacaClient();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUriFor(origin),
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alpaca rejected the login (${res.status}): ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) throw new Error("Alpaca did not return an access token");
  return json.access_token;
}

export type AlpacaAccount = {
  id: string;
  account_number?: string;
  status?: string;
  currency?: string;
  equity?: string;
  cash?: string;
  buying_power?: string;
  pattern_day_trader?: boolean;
  trading_blocked?: boolean;
};

function apiBase(env: AlpacaEnv): string {
  return env === "live" ? LIVE_API : PAPER_API;
}

export async function alpacaFetch<T>(
  token: string,
  env: AlpacaEnv,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${apiBase(env)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alpaca ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Figure out whether the token belongs to a live or paper account. */
export async function detectAccount(
  token: string,
): Promise<{ env: AlpacaEnv; account: AlpacaAccount }> {
  const errors: string[] = [];
  for (const env of ["live", "practice"] as AlpacaEnv[]) {
    try {
      const account = await alpacaFetch<AlpacaAccount>(token, env, "/v2/account");
      if (account?.id) return { env, account };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors[0] ?? "Could not read the Alpaca account for this login");
}

export async function loadSession(
  userId: string,
): Promise<{ token: string; env: AlpacaEnv; accountId: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("api_key_ciphertext, env, account_id")
    .eq("user_id", userId)
    .eq("broker", "alpaca")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No Alpaca account is connected yet");
  const { decryptSecret } = await import("@/lib/broker-crypto.server");
  return {
    token: decryptSecret(data.api_key_ciphertext),
    env: (data.env === "live" ? "live" : "practice") as AlpacaEnv,
    accountId: data.account_id ?? null,
  };
}

export async function saveSession(
  userId: string,
  token: string,
  env: AlpacaEnv,
  accountId: string,
): Promise<void> {
  const { encryptSecret } = await import("@/lib/broker-crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("user_broker_credentials").upsert(
    {
      user_id: userId,
      broker: "alpaca",
      api_key_ciphertext: encryptSecret(token),
      account_id: accountId,
      env,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,broker,env" },
  );
  if (error) throw new Error(error.message);
  await supabaseAdmin
    .from("user_broker_credentials")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("broker", "alpaca")
    .neq("env", env);
}

// Shared OANDA host resolution for the market-data feeds.
//
// An OANDA token is issued for exactly one environment: a practice token gets a
// 401 on api-fxtrade and a live token gets a 401 on api-fxpractice. OANDA_ENV is
// only a hint and is often wrong or unset, so instead of trusting it we try both
// hosts, remember the one that authorized, and stop retrying a host that has
// already rejected the token. That keeps forex/metals charts, live quotes and
// backtest history on the primary feed instead of silently degrading.
const LIVE = "api-fxtrade.oanda.com";
const PRACTICE = "api-fxpractice.oanda.com";

let authorizedHost: string | null = null;
const rejectedHosts = new Set<string>();

export function oandaHostOrder(): string[] {
  if (authorizedHost) return [authorizedHost];
  const hint = (process.env.OANDA_ENV ?? "").toLowerCase();
  const order = hint === "practice" ? [PRACTICE, LIVE] : hint === "live" ? [LIVE, PRACTICE] : [PRACTICE, LIVE];
  const usable = order.filter((h) => !rejectedHosts.has(h));
  return usable.length ? usable : order;
}

export function noteOandaAuthorized(host: string): void {
  authorizedHost = host;
  rejectedHosts.delete(host);
}

/** A 401/403 means the token belongs to the other environment, not that it is dead. */
export function noteOandaRejected(host: string): void {
  rejectedHosts.add(host);
  if (authorizedHost === host) authorizedHost = null;
}

export type OandaResponse = { host: string; json: unknown };

/**
 * GET one OANDA v3 path against whichever host accepts the configured token.
 * Throws only when every candidate host failed.
 */
export async function oandaGetJson(path: string, timeoutMs = 8_000): Promise<OandaResponse> {
  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) throw new Error("OANDA_API_KEY not configured");
  let lastError: Error = new Error("OANDA unavailable");
  // A wrong-environment 401 is expected noise: a practice token always gets 401
  // on the live host. Keep the first substantive failure (timeout, 5xx) as the
  // reported error so the real cause is not hidden behind that 401.
  let substantiveError: Error | null = null;

  for (const host of oandaHostOrder()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`https://${host}/v3${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        noteOandaRejected(host);
        lastError = new Error(`OANDA HTTP ${res.status} on ${host}`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`OANDA HTTP ${res.status} on ${host}`);
        substantiveError ??= lastError;
        continue;
      }
      noteOandaAuthorized(host);
      return { host, json: await res.json() };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("OANDA request failed");
      substantiveError ??= lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw substantiveError ?? lastError;
}

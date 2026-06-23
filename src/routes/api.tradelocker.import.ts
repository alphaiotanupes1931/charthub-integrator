import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { enforceMaxBody, enforceOrigin, preflight, rateLimit } from "@/lib/api-security";


// TradeLocker public API integration.
// We do NOT persist credentials server-side. The client passes them per request;
// server authenticates with TradeLocker, fetches orders history for the chosen
// account, normalizes to TradeMind's Trade shape, and returns them.

const ImportSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  server: z.string().min(1).max(64),
  accountType: z.enum(["demo", "live"]).default("demo"),
  accountId: z.union([z.string(), z.number()]).optional(),
  test: z.boolean().optional(),
});

function baseUrl(accountType: "demo" | "live"): string {
  return accountType === "live"
    ? "https://live.tradelocker.com/backend-api"
    : "https://demo.tradelocker.com/backend-api";
}

type TLAccount = {
  id: string | number;
  name?: string;
  accNum?: string | number;
  accountBalance?: number;
  currency?: string;
  status?: string;
};

type TLOrder = {
  id?: string | number;
  instrument?: string;
  symbol?: string;
  side?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  avgPrice?: number;
  filledPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  status?: string;
  createdAt?: string | number;
  closedAt?: string | number;
  type?: string;
};

type ImportedTrade = {
  id: string;
  date: string;
  timeframe: string;
  symbol: string;
  side: "Long" | "Short";
  entry: number;
  exit: number;
  stop: number;
  size: number;
  notes: string;
  createdAt: number;
};

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function toTrade(o: TLOrder, idx: number): ImportedTrade | null {
  const symbol = (o.instrument || o.symbol || "").toString().trim();
  if (!symbol) return null;
  const rawSide = (o.side || "").toString().toLowerCase();
  const side: "Long" | "Short" = rawSide.startsWith("s") ? "Short" : "Long";
  const entry = Number(o.avgPrice ?? o.filledPrice ?? o.price ?? 0);
  const exit = Number(o.price ?? o.avgPrice ?? entry);
  const stop = Number(o.stopLoss ?? 0);
  const size = Number(o.qty ?? o.quantity ?? 0);
  if (!entry || !size) return null;
  const ts = o.closedAt ?? o.createdAt;
  const d = ts ? new Date(typeof ts === "number" ? ts : ts) : new Date();
  return {
    id: `tl-${o.id ?? idx}-${Date.now()}`,
    date: ymd(isNaN(d.getTime()) ? new Date() : d),
    timeframe: "1H",
    symbol,
    side,
    entry,
    exit,
    stop,
    size,
    notes: `Imported from TradeLocker · ${o.status ?? ""} ${o.type ?? ""}`.trim(),
    createdAt: isNaN(d.getTime()) ? Date.now() : d.getTime(),
  };
}

async function tlFetch(url: string, init: RequestInit, label: string) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "errmsg" in body
      ? String((body as { errmsg?: unknown }).errmsg)
      : typeof body === "string" ? body.slice(0, 240) : `HTTP ${res.status}`;
    throw new Error(`${label}: ${msg}`);
  }
  return body;
}

export const Route = createFileRoute("/api/tradelocker/import")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      POST: async ({ request }) => {
        const originBlock = enforceOrigin(request);
        if (originBlock) return originBlock;
        const tooBig = enforceMaxBody(request, 16 * 1024);
        if (tooBig) return tooBig;
        const limited = rateLimit(request, { key: "tl-import", limit: 10, windowMs: 60_000 });
        if (limited) return limited;

        let raw: unknown;
        try { raw = await request.json(); } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = ImportSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
        }
        const { email, password, server, accountType, accountId, test } = parsed.data;
        const api = baseUrl(accountType);

        try {
          // 1. Auth — get JWT
          const auth = (await tlFetch(`${api}/auth/jwt/token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, server }),
          }, "Login failed")) as { accessToken?: string };

          const token = auth.accessToken;
          if (!token) {
            return Response.json({ ok: false, error: "TradeLocker did not return an access token", fallback: true });
          }

          // 2. List accounts
          const accountsResp = (await tlFetch(`${api}/auth/jwt/all-accounts`, {
            headers: { Authorization: `Bearer ${token}` },
          }, "Fetching accounts failed")) as { accounts?: TLAccount[] };

          const accounts = accountsResp.accounts ?? [];
          if (test) {
            return Response.json({
              ok: true,
              accounts: accounts.map((a) => ({
                id: a.id,
                accNum: a.accNum,
                name: a.name,
                balance: a.accountBalance,
                currency: a.currency,
                status: a.status,
              })),
            });
          }

          if (!accounts.length) {
            return Response.json({ ok: false, error: "No TradeLocker accounts found on this login" });
          }
          const acct = accountId
            ? accounts.find((a) => String(a.id) === String(accountId) || String(a.accNum) === String(accountId))
            : accounts[0];
          if (!acct) {
            return Response.json({ ok: false, error: `Account ${accountId} not found` });
          }

          // 3. Orders history
          const histResp = (await tlFetch(
            `${api}/trade/accounts/${acct.id}/ordersHistory`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                accNum: String(acct.accNum ?? acct.id),
              },
            },
            "Fetching orders history failed",
          )) as { d?: { ordersHistory?: TLOrder[] }; ordersHistory?: TLOrder[] };

          const orders = histResp.d?.ordersHistory ?? histResp.ordersHistory ?? [];
          const trades = orders
            .map((o, i) => toTrade(o, i))
            .filter((t): t is ImportedTrade => !!t);

          return Response.json({
            ok: true,
            account: { id: acct.id, accNum: acct.accNum, name: acct.name, balance: acct.accountBalance, currency: acct.currency },
            count: trades.length,
            trades,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown TradeLocker error";
          console.error("[tradelocker/import]", msg);
          // Return 200 with structured error so the client SSR/error boundary
          // does not flag this as a runtime crash. See troubleshooting docs.
          return Response.json({ ok: false, error: msg, fallback: true });
        }
      },
    },
  },
});

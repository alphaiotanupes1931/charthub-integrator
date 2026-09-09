// Read-only broker account snapshot.
//
// Phase 3 of the build plan: the coach should be able to SEE the trader's real
// account (balance, open positions, recent closes) without any ability to place
// or modify orders. Everything here is GET-only on purpose; order placement
// stays in the existing broker-* modules behind the broker_live capability.
//
// Credentials never leave the server: tokens are loaded from
// public.user_broker_credentials and decrypted here.

export type ReadOnlyPosition = {
  symbol: string;
  side: "long" | "short";
  units: number;
  entry: number;
  unrealizedPL: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: string | null;
};

export type ReadOnlyClose = {
  symbol: string;
  side: "long" | "short";
  units: number;
  price: number;
  realizedPL: number;
  closedAt: string | null;
};

export type BrokerSnapshot = {
  broker: "oanda" | "tradelocker";
  env: string;
  accountId: string | null;
  currency: string | null;
  balance: number | null;
  equity: number | null;
  unrealizedPL: number | null;
  positions: ReadOnlyPosition[];
  recentCloses: ReadOnlyClose[];
  fetchedAt: number;
};

export type BrokerSnapshotResult =
  | { connected: true; snapshots: BrokerSnapshot[] }
  | { connected: false; reason: string };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Pretty instrument label: OANDA/TradeLocker use EUR_USD, traders read EUR/USD. */
function prettySymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(4)}`;
  return s.replace(/_USD$/, "").replace(/_/g, "/");
}

// ---------------------------------------------------------------- OANDA

export type OandaCreds = { apiKey: string; accountId: string | null; env: "practice" | "live" };

export async function loadOandaCreds(userId: string): Promise<OandaCreds | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("api_key_ciphertext, account_id, env, is_active, updated_at")
    .eq("user_id", userId)
    .eq("broker", "oanda")
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false });
  const row = (data ?? [])[0];
  if (row) {
    const { decryptSecret } = await import("@/lib/broker-crypto.server");
    return {
      apiKey: decryptSecret(row.api_key_ciphertext),
      accountId: row.account_id?.trim() || null,
      env: (row.env as "practice" | "live") ?? "practice",
    };
  }
  const envKey = process.env.OANDA_API_KEY;
  if (!envKey) return null;
  return {
    apiKey: envKey,
    accountId: process.env.OANDA_ACCOUNT_ID?.trim() || null,
    env: (process.env.OANDA_ENV ?? "practice").toLowerCase() === "live" ? "live" : "practice",
  };
}

export const oandaHost = (env: "practice" | "live") =>
  env === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";

export async function oandaGet(host: string, apiKey: string, path: string) {
  const res = await fetch(`https://${host}/v3${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, body };
}

/** Resolve the account id on whichever OANDA server the token belongs to. */
export async function resolveOandaTarget(creds: OandaCreds) {
  const order: Array<"practice" | "live"> = creds.env === "live" ? ["live", "practice"] : ["practice", "live"];
  for (const env of order) {
    const host = oandaHost(env);
    if (creds.accountId) {
      const summary = await oandaGet(host, creds.apiKey, `/accounts/${creds.accountId}/summary`);
      if (summary.ok) return { host, env, accountId: creds.accountId, summary: summary.body };
    }
    const listed = await oandaGet(host, creds.apiKey, "/accounts");
    const accounts = Array.isArray(listed.body.accounts) ? (listed.body.accounts as Array<{ id?: string }>) : [];
    const id = accounts.find((a) => a.id)?.id;
    if (id) {
      const summary = await oandaGet(host, creds.apiKey, `/accounts/${id}/summary`);
      if (summary.ok) return { host, env, accountId: id, summary: summary.body };
    }
  }
  return null;
}

async function oandaSnapshot(userId: string): Promise<BrokerSnapshot | null> {
  const creds = await loadOandaCreds(userId);
  if (!creds) return null;
  const target = await resolveOandaTarget(creds);
  if (!target) return null;

  const account = (target.summary.account ?? {}) as Record<string, string>;
  const [open, closed] = await Promise.all([
    oandaGet(target.host, creds.apiKey, `/accounts/${target.accountId}/openTrades`),
    oandaGet(target.host, creds.apiKey, `/accounts/${target.accountId}/trades?state=CLOSED&count=10`),
  ]);

  const positions: ReadOnlyPosition[] = (
    Array.isArray(open.body.trades) ? (open.body.trades as Array<Record<string, unknown>>) : []
  ).map((t) => {
    const units = num(t.currentUnits);
    return {
      symbol: prettySymbol(String(t.instrument ?? "")),
      side: units >= 0 ? "long" : "short",
      units: Math.abs(units),
      entry: num(t.price),
      unrealizedPL: num(t.unrealizedPL),
      stopLoss: (t.stopLossOrder as { price?: string } | undefined)?.price
        ? num((t.stopLossOrder as { price: string }).price)
        : null,
      takeProfit: (t.takeProfitOrder as { price?: string } | undefined)?.price
        ? num((t.takeProfitOrder as { price: string }).price)
        : null,
      openedAt: (t.openTime as string) ?? null,
    };
  });

  const recentCloses: ReadOnlyClose[] = (
    Array.isArray(closed.body.trades) ? (closed.body.trades as Array<Record<string, unknown>>) : []
  ).map((t) => {
    const units = num(t.initialUnits);
    return {
      symbol: prettySymbol(String(t.instrument ?? "")),
      side: units >= 0 ? "long" : "short",
      units: Math.abs(units),
      price: num(t.averageClosePrice ?? t.price),
      realizedPL: num(t.realizedPL),
      closedAt: (t.closeTime as string) ?? null,
    };
  });

  return {
    broker: "oanda",
    env: target.env,
    accountId: account.id ?? target.accountId,
    currency: account.currency ?? null,
    balance: account.balance ? num(account.balance) : null,
    equity: account.NAV ? num(account.NAV) : null,
    unrealizedPL: account.unrealizedPL ? num(account.unrealizedPL) : null,
    positions,
    recentCloses,
    fetchedAt: Date.now(),
  };
}

// ----------------------------------------------------------- TradeLocker

async function tradeLockerSnapshot(userId: string): Promise<BrokerSnapshot | null> {
  const { tlSession, tlBase, tlHeaders } = await import("@/lib/broker-tradelocker.server");
  const session = await tlSession(userId);
  if (!session?.account) return null;
  const { creds, token, account } = session;
  const base = tlBase(creds.env);
  const headers = tlHeaders(token, account);
  const accId = String(account.id ?? account.accNum ?? "");

  let positions: ReadOnlyPosition[] = [];
  try {
    const res = await fetch(`${base}/trade/accounts/${accId}/positions`, { headers });
    if (res.ok) {
      const body = (await res.json()) as { d?: { positions?: unknown[] } };
      const rows = Array.isArray(body?.d?.positions) ? (body.d!.positions as unknown[]) : [];
      // TradeLocker returns positions as ordered arrays described by a config
      // endpoint; only the stable leading fields are read here.
      positions = rows
        .map((row) => (Array.isArray(row) ? row : []))
        .filter((row) => row.length >= 6)
        .map((row) => {
          const qty = num(row[4]);
          return {
            symbol: prettySymbol(String(row[1] ?? "")),
            side: String(row[3] ?? "").toLowerCase() === "sell" ? ("short" as const) : ("long" as const),
            units: Math.abs(qty),
            entry: num(row[5]),
            unrealizedPL: num(row[8]),
            stopLoss: null,
            takeProfit: null,
            openedAt: null,
          };
        });
    }
  } catch {
    /* read-only: a failed position read must not break the snapshot */
  }

  // Closed positions come back either as objects or as the ordered arrays
  // TradeLocker uses elsewhere, so both shapes are read defensively.
  let recentCloses: ReadOnlyClose[] = [];
  try {
    const res = await fetch(
      `${base}/trade/reports/closed-positions?accountId=${encodeURIComponent(accId)}`,
      { headers },
    );
    if (res.ok) {
      const body = (await res.json()) as { d?: unknown };
      const d = body?.d as Record<string, unknown> | unknown[] | undefined;
      const rows: unknown[] = Array.isArray(d)
        ? d
        : Array.isArray((d as Record<string, unknown>)?.["positions"])
          ? ((d as Record<string, unknown>)["positions"] as unknown[])
          : Array.isArray((d as Record<string, unknown>)?.["closedPositions"])
            ? ((d as Record<string, unknown>)["closedPositions"] as unknown[])
            : [];
      recentCloses = rows
        .map((row): ReadOnlyClose | null => {
          if (Array.isArray(row)) {
            if (row.length < 6) return null;
            const qty = num(row[4]);
            return {
              symbol: prettySymbol(String(row[1] ?? "")),
              side: String(row[3] ?? "").toLowerCase() === "sell" ? "short" : "long",
              units: Math.abs(qty),
              price: num(row[6] ?? row[5]),
              realizedPL: num(row[7]),
              closedAt: row[2] ? new Date(num(row[2]) || String(row[2])).toISOString() : null,
            };
          }
          const o = row as Record<string, unknown>;
          const symbol = prettySymbol(String(o["tradableInstrumentName"] ?? o["instrument"] ?? o["symbol"] ?? ""));
          if (!symbol) return null;
          const qty = num(o["qty"] ?? o["quantity"] ?? o["units"]);
          const closed = o["closeTime"] ?? o["closedAt"] ?? o["dateClosed"];
          return {
            symbol,
            side: String(o["side"] ?? "").toLowerCase() === "sell" ? "short" : "long",
            units: Math.abs(qty),
            price: num(o["closePrice"] ?? o["avgPrice"] ?? o["price"]),
            realizedPL: num(o["netPnl"] ?? o["realizedPl"] ?? o["pnl"]),
            closedAt: closed ? new Date(num(closed) || String(closed)).toISOString() : null,
          };
        })
        .filter((c): c is ReadOnlyClose => !!c)
        .sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? ""))
        .slice(0, 20);
    }
  } catch {
    /* read-only: closed history is optional */
  }

  return {
    broker: "tradelocker",
    env: creds.env,
    accountId: accId || null,
    currency: (account as { currency?: string }).currency ?? null,
    balance: (account as { accountBalance?: number }).accountBalance ?? null,
    equity: null,
    unrealizedPL: positions.reduce((s, p) => s + p.unrealizedPL, 0) || null,
    positions,
    recentCloses,
    fetchedAt: Date.now(),
  };
}


/** Every read-only snapshot we can build for this user. Never throws. */
export async function buildBrokerSnapshots(userId: string): Promise<BrokerSnapshotResult> {
  const results = await Promise.allSettled([oandaSnapshot(userId), tradeLockerSnapshot(userId)]);
  const snapshots = results
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((s): s is BrokerSnapshot => !!s);
  if (!snapshots.length) {
    const reason =
      results.find((r) => r.status === "rejected") &&
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason instanceof Error
        ? ((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).message
        : "No broker account is linked yet.";
    return { connected: false, reason };
  }
  return { connected: true, snapshots };
}

/** Compact prompt block so the coach stops asking where price is. */
export function brokerContextBlock(result: BrokerSnapshotResult): string {
  if (!result.connected) return "";
  const lines: string[] = [];
  for (const s of result.snapshots) {
    const money = [
      s.balance != null ? `balance ${s.balance}${s.currency ? ` ${s.currency}` : ""}` : null,
      s.equity != null ? `equity ${s.equity}` : null,
      s.unrealizedPL != null ? `open P&L ${s.unrealizedPL}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`${s.broker.toUpperCase()} (${s.env})${money ? `: ${money}` : ""}`);
    if (s.positions.length === 0) {
      lines.push("  No open positions.");
    } else {
      for (const p of s.positions) {
        lines.push(
          `  OPEN ${p.side.toUpperCase()} ${p.symbol} ${p.units} @ ${p.entry}` +
            `${p.stopLoss != null ? ` SL ${p.stopLoss}` : " SL none"}` +
            `${p.takeProfit != null ? ` TP ${p.takeProfit}` : " TP none"}` +
            ` unrealized ${p.unrealizedPL}`,
        );
      }
    }
    for (const c of s.recentCloses.slice(0, 5)) {
      lines.push(`  CLOSED ${c.side.toUpperCase()} ${c.symbol} ${c.units} @ ${c.price} P&L ${c.realizedPL}`);
    }
  }
  return `LIVE BROKER ACCOUNT (read-only, refreshed just now)
${lines.join("\n")}

Use these real positions when the trader asks about managing a trade: you already know their side, size, entry, stop and open P&L, so never ask where price is or what they are in. You cannot place, modify or close orders; if they ask you to, tell them to use their broker or the order ticket in the app.`;
}

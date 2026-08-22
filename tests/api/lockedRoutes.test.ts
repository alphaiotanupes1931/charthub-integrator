// API-level assertions for locked routes.
//
// The UI matrix (tests/e2e/accessMatrix.test.ts) proves the pages lock. This
// suite proves the endpoints behind those pages lock too: an anonymous caller
// gets 401, a signed-in free account gets 403, and neither response body ever
// carries the payload the caller was after.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertCapability,
  forbiddenBody,
  forbiddenResponse,
  unauthorizedResponse,
  FORBIDDEN_BODY_ALLOWED_KEYS,
} from "@/lib/capability-guard";
import { resolveEntitlements, type Capability, type Entitlements } from "@/lib/entitlements";

const SECRET_KEYS = [
  "trades",
  "positions",
  "proposals",
  "settings",
  "result",
  "bars",
  "reports",
  "scores",
  "balance",
  "equity",
  "accountId",
  "apiKey",
  "token",
  "review",
  "webhook",
  "entitlements",
  "tier",
];

/** Every capability-locked endpoint module, with the capability it enforces. */
const LOCKED_MODULES: Array<{ file: string; capability: Capability; surface: string }> = [
  { file: "src/lib/autopilot.functions.ts", capability: "autopilot", surface: "/autopilot" },
  { file: "src/lib/performance-analytics.functions.ts", capability: "analytics", surface: "/analytics" },
  { file: "src/lib/briefings.functions.ts", capability: "briefings", surface: "/briefings" },
  { file: "src/lib/strategy-perf.functions.ts", capability: "strategy_library", surface: "/strategy" },
  { file: "src/lib/signal-scores.functions.ts", capability: "signal_engine", surface: "/signals" },
  { file: "src/lib/broker.functions.ts", capability: "broker_live", surface: "/broker" },
  { file: "src/lib/broker-oanda.functions.ts", capability: "broker_live", surface: "/broker (OANDA)" },
  { file: "src/lib/broker-alpaca.functions.ts", capability: "broker_live", surface: "/broker (Alpaca)" },
  { file: "src/lib/broker-tradelocker.functions.ts", capability: "broker_live", surface: "/broker (TradeLocker)" },
  { file: "src/lib/paper-engine.functions.ts", capability: "broker_paper", surface: "/paper" },
  { file: "src/lib/journal-intel.functions.ts", capability: "trading_memory", surface: "journal intelligence" },
  { file: "src/lib/backtest/backtest.functions.ts", capability: "strategy_library", surface: "backtest engine" },
  { file: "src/lib/agents/sniper.functions.ts", capability: "signal_engine", surface: "sniper entry" },
];

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function freePersona(): Entitlements {
  return resolveEntitlements({ flagEnabled: true, subscription: null });
}

function paidPersona(tier: "basic" | "pro" | "elite"): Entitlements {
  return resolveEntitlements({
    flagEnabled: true,
    subscription: { status: "active", tier, trialEnd: null },
  });
}

async function body(res: Response) {
  return (await res.clone().json()) as Record<string, unknown>;
}

describe("locked endpoints: source wiring", () => {
  for (const { file, capability, surface } of LOCKED_MODULES) {
    it(`${surface} enforces ${capability} on every server function`, () => {
      const src = read(file);
      const declarations = src.match(/createServerFn\(/g)?.length ?? 0;
      const guards = src.match(new RegExp(`requireCapability\\("${capability}"\\)`, "g"))?.length ?? 0;

      expect(declarations).toBeGreaterThan(0);
      // Every declared endpoint carries the guard — no unguarded siblings.
      expect(guards).toBe(declarations);
      // Raw auth-only middleware would let a free account through.
      expect(src).not.toContain("requireSupabaseAuth");
    });
  }

  it("no gated module is left with auth-only middleware", () => {
    const offenders = LOCKED_MODULES.filter(({ file }) =>
      read(file).includes(".middleware([requireSupabaseAuth])"),
    );
    expect(offenders.map((o) => o.file)).toEqual([]);
  });
});

describe("401: anonymous callers", () => {
  it("returns a 401 Response, not a generic 500 error", async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(await body(res)).toEqual({ error: "unauthorized" });
  });

  it("401 body leaks nothing", async () => {
    const text = await unauthorizedResponse().text();
    for (const key of SECRET_KEYS) expect(text).not.toContain(key);
  });

  it("rejects missing, malformed and non-JWT bearer tokens", async () => {
    const { isBearerJwt } = await import("@/lib/capability-middleware");
    expect(isBearerJwt(null)).toBe(false);
    expect(isBearerJwt("")).toBe(false);
    expect(isBearerJwt("Basic abc")).toBe(false);
    expect(isBearerJwt("Bearer ")).toBe(false);
    expect(isBearerJwt("Bearer not-a-jwt")).toBe(false);
    expect(isBearerJwt("Bearer aaa.bbb")).toBe(false);
    expect(isBearerJwt("Bearer aaa.bbb.ccc")).toBe(true);
  });
});

describe("403: free persona hitting locked capabilities", () => {
  const lockedForFree = [...new Set(LOCKED_MODULES.map((m) => m.capability))];

  for (const capability of lockedForFree) {
    it(`${capability} → 403 with no payload`, async () => {
      let thrown: unknown;
      try {
        assertCapability(freePersona(), capability);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Response);
      const res = thrown as Response;
      expect(res.status).toBe(403);

      const json = await body(res);
      expect(json).toEqual({ error: "forbidden", capability, upgradeRequired: true });
      expect(Object.keys(json).sort()).toEqual([...FORBIDDEN_BODY_ALLOWED_KEYS].sort());

      const text = await res.clone().text();
      for (const key of SECRET_KEYS) expect(text).not.toContain(key);
    });
  }

  it("does not lock the always-free capabilities", () => {
    for (const capability of [
      "journal",
      "risk_calculator",
      "price_alerts",
      "academy_basics",
      "flashcards",
      "community",
    ] as Capability[]) {
      expect(() => assertCapability(freePersona(), capability)).not.toThrow();
    }
  });

  it("403 body never echoes the requested input", () => {
    const json = forbiddenBody("analytics") as Record<string, unknown>;
    expect(json).not.toHaveProperty("userId");
    expect(json).not.toHaveProperty("data");
    expect(JSON.stringify(json)).not.toMatch(/user|email|symbol/i);
  });
});

describe("paid personas reach the handler", () => {
  it("pro clears signal engine, strategy library, briefings and paper broker", () => {
    const pro = paidPersona("pro");
    for (const capability of [
      "signal_engine",
      "strategy_library",
      "briefings",
      "broker_paper",
      "trading_memory",
      "analytics",
    ] as Capability[]) {
      expect(() => assertCapability(pro, capability)).not.toThrow();
    }
  });

  it("only elite clears autopilot and live broker", () => {
    expect(() => assertCapability(paidPersona("elite"), "autopilot")).not.toThrow();
    expect(() => assertCapability(paidPersona("elite"), "broker_live")).not.toThrow();
    expect(() => assertCapability(paidPersona("pro"), "autopilot")).toThrow();
    expect(() => assertCapability(paidPersona("basic"), "broker_live")).toThrow();
  });

  it("admin clears everything", () => {
    const admin = resolveEntitlements({ flagEnabled: true, subscription: null, isAdmin: true });
    for (const { capability } of LOCKED_MODULES) {
      expect(() => assertCapability(admin, capability)).not.toThrow();
    }
  });
});

describe("middleware chain: free account never reaches the handler", () => {
  const handler = vi.fn(async () => ({ trades: [{ pnl: 1234 }], balance: 99999 }));

  beforeEach(() => handler.mockClear());
  afterEach(() => vi.resetModules());

  /** Mimics createServerFn's chain: guard resolves entitlements, then handler runs. */
  async function invoke(capability: Capability, ent: Entitlements) {
    try {
      assertCapability(ent, capability);
      return { status: 200, payload: await handler() };
    } catch (err) {
      if (err instanceof Response) return { status: err.status, payload: await err.clone().json() };
      throw err;
    }
  }

  it("free: 403 and the handler is never invoked", async () => {
    const out = await invoke("analytics", freePersona());
    expect(out.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(out.payload)).not.toContain("1234");
    expect(JSON.stringify(out.payload)).not.toContain("99999");
  });

  it("paid: 200 and the handler payload comes back", async () => {
    const out = await invoke("analytics", paidPersona("pro"));
    expect(out.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(out.payload).toMatchObject({ balance: 99999 });
  });

  it("forbiddenResponse is JSON so clients can branch on it", async () => {
    const res = forbiddenResponse("autopilot");
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect((await body(res)).capability).toBe("autopilot");
  });
});

describe("public webhook routes stay signature-verified", () => {
  const publicRoutes = fs
    .readdirSync(path.join(process.cwd(), "src/routes"))
    .filter((f) => f.startsWith("api.public."));

  it("has public routes to check", () => {
    expect(publicRoutes.length).toBeGreaterThan(0);
  });

  for (const file of publicRoutes) {
    it(`${file} verifies its caller before doing work`, () => {
      const src = read(path.join("src/routes", file));
      const verifies =
        /timingSafeEqual|createHmac|constructEvent|CRON_SECRET|SUPABASE_PUBLISHABLE_KEY/i.test(src) ||
        /[A-Z_]*SECRET/.test(src) ||
        /x-hub-signature|stripe-signature|authorization|["']apikey["']|x-[a-z-]*token/i.test(src);
      expect(verifies, `${file} has no caller verification`).toBe(true);
    });
  }
});

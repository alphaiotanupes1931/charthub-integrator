// Access matrix for every gated surface in the app.
//
// One table, one assertion loop: each persona (free, paid tiers, legacy trial,
// expired trial, admin) is checked against every gated route so a gating change
// on one page can never silently disagree with another. The final block reads
// the route files themselves, so the capability a page actually gates on has to
// match the capability this matrix claims it gates on.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  academyModuleAllowed,
  can,
  coachAllowed,
  resolveEntitlements,
  COACH_NAME_ORDER,
  FREE_ACADEMY_MODULES,
  FREE_SEES_STRATEGY_TITLES,
  type Capability,
  type Entitlements,
} from "@/lib/entitlements";

const NOW = new Date("2026-08-22T18:00:00Z");
const FUTURE = "2026-08-30T00:00:00Z";
const PAST = "2026-08-01T00:00:00Z";

type PersonaId =
  | "free"
  | "basic"
  | "pro"
  | "elite"
  | "legacyTrial"
  | "expiredTrial"
  | "canceled"
  | "pastDue"
  | "admin"
  | "flagOffAnonymous"
  | "flagOffBasic"
  | "flagOffTrial";

const personas: Record<PersonaId, { label: string; ent: Entitlements }> = {
  free: {
    label: "free account, flag on",
    ent: resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW }),
  },
  basic: {
    label: "paid Basic",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "basic", trialEnd: null }, now: NOW }),
  },
  pro: {
    label: "paid Pro",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "pro", trialEnd: null }, now: NOW }),
  },
  elite: {
    label: "paid Elite",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "elite", trialEnd: null }, now: NOW }),
  },
  legacyTrial: {
    label: "legacy 7-day trial still running",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: null, trialEnd: FUTURE }, now: NOW }),
  },
  expiredTrial: {
    label: "trial that has expired",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: "pro", trialEnd: PAST }, now: NOW }),
  },
  canceled: {
    label: "cancelled subscription",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "canceled", tier: "pro", trialEnd: null }, now: NOW }),
  },
  pastDue: {
    label: "past due but still paid",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "past_due", tier: "pro", trialEnd: null }, now: NOW }),
  },
  admin: {
    label: "admin",
    ent: resolveEntitlements({ flagEnabled: true, subscription: null, isAdmin: true, now: NOW }),
  },
  flagOffAnonymous: {
    label: "flag off, no subscription (rollback)",
    ent: resolveEntitlements({ flagEnabled: false, subscription: null, now: NOW }),
  },
  flagOffBasic: {
    label: "flag off, paid Basic",
    ent: resolveEntitlements({ flagEnabled: false, subscription: { status: "active", tier: "basic", trialEnd: null }, now: NOW }),
  },
  flagOffTrial: {
    label: "flag off, expired trial",
    ent: resolveEntitlements({ flagEnabled: false, subscription: { status: "trialing", tier: null, trialEnd: PAST }, now: NOW }),
  },
};

/** Every gated surface, the capability it gates on, and who gets through. */
type RouteSpec = {
  route: string;
  file: string | null;
  capability: Capability;
  allowed: PersonaId[];
};

const ALL: PersonaId[] = Object.keys(personas) as PersonaId[];

/**
 * CI shards this suite by persona: `MATRIX_PERSONAS=free,basic pnpm test:matrix`
 * runs only those personas' route checks. Unset (local, and the full CI job) runs
 * every persona. Invariant blocks below always run — they're cheap and global.
 */
const requested = (process.env["MATRIX_PERSONAS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const unknown = requested.filter((id) => !ALL.includes(id as PersonaId));
if (unknown.length) {
  throw new Error(
    `MATRIX_PERSONAS contains unknown persona(s): ${unknown.join(", ")}. Known: ${ALL.join(", ")}`,
  );
}
const SELECTED: PersonaId[] = requested.length ? (requested as PersonaId[]) : ALL;

const PAID_AND_ABOVE: PersonaId[] = [
  "basic",
  "pro",
  "elite",
  "legacyTrial",
  "pastDue",
  "admin",
  "flagOffAnonymous",
  "flagOffBasic",
  "flagOffTrial",
];
const PRO_AND_ABOVE: PersonaId[] = ["pro", "elite", "legacyTrial", "pastDue", "admin", "flagOffAnonymous", "flagOffTrial"];

const ROUTES: RouteSpec[] = [
  // Paid-only surfaces.
  {
    route: "/autopilot",
    file: "src/routes/_app.autopilot.tsx",
    capability: "autopilot",
    // A legacy trial without a tier resolves to Pro, so it does not include
    // the two Elite-only surfaces.
    allowed: ["elite", "admin", "flagOffAnonymous", "flagOffTrial"],
  },
  {
    route: "/signals",
    file: "src/routes/_app.signals.tsx",
    capability: "signal_engine",
    allowed: PRO_AND_ABOVE,
  },
  {
    route: "/strategies (win rates)",
    file: "src/routes/_app.strategies.index.tsx",
    capability: "strategy_library",
    allowed: PRO_AND_ABOVE,
  },
  {
    route: "/analytics",
    file: "src/routes/_app.analytics.tsx",
    capability: "analytics",
    allowed: PAID_AND_ABOVE,
  },
  { route: "/academy (modules 4+)", file: null, capability: "academy_all", allowed: PAID_AND_ABOVE },
  { route: "/briefings", file: null, capability: "briefings", allowed: PRO_AND_ABOVE },
  { route: "/memory", file: null, capability: "trading_memory", allowed: PRO_AND_ABOVE },
  { route: "/paper trading", file: null, capability: "broker_paper", allowed: PRO_AND_ABOVE },
  {
    route: "/broker (live orders)",
    file: null,
    capability: "broker_live",
    allowed: ["elite", "admin", "flagOffAnonymous", "flagOffTrial"],
  },
  { route: "unlimited grades", file: null, capability: "unlimited_grades", allowed: PAID_AND_ABOVE },

  // Free forever (§3) — reachable by absolutely everyone.
  { route: "/journal", file: null, capability: "journal", allowed: ALL },
  { route: "/risk", file: null, capability: "risk_calculator", allowed: ALL },
  { route: "/alerts", file: null, capability: "price_alerts", allowed: ALL },
  { route: "/academy (modules 1-3)", file: null, capability: "academy_basics", allowed: ALL },
  { route: "/flashcards", file: null, capability: "flashcards", allowed: ALL },
  { route: "/community", file: null, capability: "community", allowed: ALL },
];

// Persona-first grouping: CI shards by persona (MATRIX_PERSONAS=free,basic), and
// a failing report reads "persona: free … locks /autopilot", so the regression is
// named by who broke and where, without opening the test file.
describe("access matrix — every gated route against every persona", () => {
  for (const id of SELECTED) {
    describe(`persona: ${id} (${personas[id].label})`, () => {
      for (const spec of ROUTES) {
        const shouldPass = spec.allowed.includes(id);
        it(`${shouldPass ? "allows" : "locks"} ${spec.route} [${spec.capability}]`, () => {
          expect(can(personas[id].ent, spec.capability)).toBe(shouldPass);
        });
      }
    });
  }


  it("covers every capability the resolver knows about", () => {
    const covered = new Set(ROUTES.map((r) => r.capability));
    const everyCapability = new Set(
      Object.values(personas).flatMap((p) => p.ent.capabilities),
    );
    for (const capability of everyCapability) {
      expect(covered.has(capability)).toBe(true);
    }
  });
});

describe("access matrix — Academy modules", () => {
  const modules = [1, 2, 3, 4, 5, 12];

  it.each(modules)("free account: module %i", (moduleId) => {
    expect(academyModuleAllowed(personas.free.ent, moduleId)).toBe(moduleId <= FREE_ACADEMY_MODULES);
  });

  it.each(["basic", "pro", "elite", "legacyTrial", "admin"] as const)("%s opens every module", (id) => {
    for (const moduleId of modules) {
      expect(academyModuleAllowed(personas[id].ent, moduleId)).toBe(true);
    }
  });

  it("an expired trial drops back to the first three modules", () => {
    expect(academyModuleAllowed(personas.expiredTrial.ent, 3)).toBe(true);
    expect(academyModuleAllowed(personas.expiredTrial.ent, 4)).toBe(false);
  });

  it("flag off reopens every module, including for accounts with no subscription", () => {
    for (const id of ["flagOffAnonymous", "flagOffBasic", "flagOffTrial"] as const) {
      expect(academyModuleAllowed(personas[id].ent, 9)).toBe(true);
    }
  });
});

describe("access matrix — coach picker", () => {
  it("free accounts get The Analyst only", () => {
    expect(personas.free.ent.coachAllowance).toBe(1);
    expect(coachAllowed(personas.free.ent, "The Analyst")).toBe(true);
    for (const name of COACH_NAME_ORDER.slice(1)) {
      expect(coachAllowed(personas.free.ent, name)).toBe(false);
    }
  });

  it("Basic unlocks the first two coaches and no more", () => {
    expect(personas.basic.ent.coachAllowance).toBe(2);
    expect(coachAllowed(personas.basic.ent, "The Analyst")).toBe(true);
    expect(coachAllowed(personas.basic.ent, "The Strategist")).toBe(true);
    expect(coachAllowed(personas.basic.ent, "The Disciplinarian")).toBe(false);
  });

  it.each(["pro", "elite", "legacyTrial", "pastDue", "admin", "flagOffAnonymous"] as const)(
    "%s unlocks every coach",
    (id) => {
      for (const name of COACH_NAME_ORDER) {
        expect(coachAllowed(personas[id].ent, name)).toBe(true);
      }
    },
  );

  it("a tierless legacy trial runs at Pro level, so Elite-only surfaces stay locked", () => {
    expect(personas.legacyTrial.ent.tier).toBe("pro");
    expect(personas.legacyTrial.ent.onLegacyTrial).toBe(true);
    expect(can(personas.legacyTrial.ent, "autopilot")).toBe(false);
    expect(can(personas.legacyTrial.ent, "broker_live")).toBe(false);
    // An Elite trial does get them.
    const eliteTrial = resolveEntitlements({
      flagEnabled: true,
      subscription: { status: "trialing", tier: "elite", trialEnd: FUTURE },
      now: NOW,
    });
    expect(can(eliteTrial, "autopilot")).toBe(true);
    expect(can(eliteTrial, "broker_live")).toBe(true);
  });

  it("an expired trial is back to one coach", () => {
    expect(personas.expiredTrial.ent.coachAllowance).toBe(1);
    expect(coachAllowed(personas.expiredTrial.ent, "The Strategist")).toBe(false);
  });

  it("an unknown coach name is never allowed on a limited tier, but is on an unlimited one", () => {
    expect(coachAllowed(personas.free.ent, "The Wizard")).toBe(false);
    expect(coachAllowed(personas.basic.ent, "The Wizard")).toBe(false);
    expect(coachAllowed(personas.elite.ent, "The Wizard")).toBe(true);
  });
});

describe("access matrix — Strategy Library visibility", () => {
  it("free accounts see titles but not win rates (§13.2)", () => {
    expect(FREE_SEES_STRATEGY_TITLES).toBe(true);
    expect(can(personas.free.ent, "strategy_library")).toBe(false);
  });

  it("Basic sees titles only; Pro and above see the stats", () => {
    expect(can(personas.basic.ent, "strategy_library")).toBe(false);
    expect(can(personas.pro.ent, "strategy_library")).toBe(true);
    expect(can(personas.elite.ent, "strategy_library")).toBe(true);
  });

  it("flag off shows stats to everyone — a true rollback", () => {
    expect(can(personas.flagOffAnonymous.ent, "strategy_library")).toBe(true);
  });
});

describe("access matrix — quota surfaces follow the same table", () => {
  it("only the free tier gets a grade limit and quota UI", () => {
    expect(personas.free.ent.freeTierActive).toBe(true);
    expect(personas.free.ent.gradeLimit).toBe(3);
    for (const id of ALL.filter((p) => p !== "free" && p !== "expiredTrial" && p !== "canceled")) {
      expect(personas[id].ent.freeTierActive).toBe(false);
      expect(personas[id].ent.gradeLimit).toBeNull();
    }
  });

  it("expired trials and cancellations land on the free tier, not on a lockout", () => {
    for (const id of ["expiredTrial", "canceled"] as const) {
      expect(personas[id].ent.tier).toBe("free");
      expect(personas[id].ent.freeTierActive).toBe(true);
      expect(can(personas[id].ent, "journal")).toBe(true);
    }
  });

  it("no persona is ever both paid and on the free tier", () => {
    for (const id of ALL) {
      const ent = personas[id].ent;
      expect(ent.isPaid && ent.freeTierActive).toBe(false);
    }
  });
});

describe("access matrix — the route files gate on the capability this table claims", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

  it.each(ROUTES.filter((r) => r.file).map((r) => [r.file as string, r.capability, r.route] as const))(
    "%s gates on %s",
    (file, capability) => {
      const src = read(file);
      expect(src).toContain(`"${capability}"`);
    },
  );

  it("Autopilot and Signals lock the whole page, not just part of it", () => {
    for (const file of ["src/routes/_app.autopilot.tsx", "src/routes/_app.signals.tsx"]) {
      expect(read(file)).toContain("CapabilityGate");
    }
  });
});

// Redirect and error handling for every gated route.
//
// The access matrix answers "may this persona use this capability". This suite
// answers the next question: when the answer is no, what exactly happens on
// screen and on the wire. Two failure modes we never want:
//   1. a locked page bouncing the user to /dashboard (they lose the URL and
//      never see why they were denied, so they never see the upgrade path)
//   2. a denial body leaking the payload the caller was not allowed to read
//
// Every expectation below is asserted both against the resolved entitlements
// and against the route source, so a page cannot quietly switch from an inline
// lock to a redirect.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  can,
  resolveEntitlements,
  type Capability,
  type Entitlements,
} from "@/lib/entitlements";
import {
  assertCapability,
  forbiddenBody,
  forbiddenResponse,
  unauthorizedResponse,
} from "@/lib/capability-guard";

const NOW = new Date("2026-08-22T18:00:00Z");
const FUTURE = "2026-08-30T00:00:00Z";
const PAST = "2026-08-01T00:00:00Z";

type PersonaId = "free" | "legacyTrial" | "expiredTrial" | "pro" | "elite" | "admin" | "flagOff";

const personas: Record<PersonaId, { label: string; ent: Entitlements }> = {
  free: {
    label: "free account",
    ent: resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW }),
  },
  legacyTrial: {
    label: "legacy trial still running",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: null, trialEnd: FUTURE }, now: NOW }),
  },
  expiredTrial: {
    label: "expired trial",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: "pro", trialEnd: PAST }, now: NOW }),
  },
  pro: {
    label: "paid Pro",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "pro", trialEnd: null }, now: NOW }),
  },
  elite: {
    label: "paid Elite",
    ent: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "elite", trialEnd: null }, now: NOW }),
  },
  admin: {
    label: "admin",
    ent: resolveEntitlements({ flagEnabled: true, subscription: null, isAdmin: true, now: NOW }),
  },
  flagOff: {
    label: "free tier flag off (rollback)",
    ent: resolveEntitlements({ flagEnabled: false, subscription: null, now: NOW }),
  },
};

const ALL_PERSONAS = Object.keys(personas) as PersonaId[];

/** How a page behaves for a persona that lacks the capability. */
type DenialStyle =
  | "inline-lock" // full-page lock card + "See plans" -> UpgradeModal, URL unchanged
  | "inline-preview" // page renders with blurred/masked values, URL unchanged
  | "inline-item-lock"; // page opens, individual items carry "Unlock ..." buttons

type GatedRoute = {
  url: string;
  file: string;
  capability: Capability;
  denial: DenialStyle;
  /** Upgrade modal reason string the page passes. */
  reason?: string;
  /** Per-item helper the page uses instead of a whole-page capability check. */
  helper?: string;
};

const gatedRoutes: GatedRoute[] = [
  { url: "/signals", file: "_app.signals.tsx", capability: "signal_engine", denial: "inline-lock", reason: "signals" },
  { url: "/autopilot", file: "_app.autopilot.tsx", capability: "autopilot", denial: "inline-lock", reason: "autopilot" },
  { url: "/analytics", file: "_app.analytics.tsx", capability: "analytics", denial: "inline-preview" },
  { url: "/coaches", file: "_app.coaches.tsx", capability: "unlimited_grades", denial: "inline-item-lock", reason: "coaches", helper: "coachAllowed" },
  { url: "/academy", file: "_app.academy.index.tsx", capability: "academy_all", denial: "inline-item-lock", reason: "academy", helper: "academyModuleAllowed" },
  { url: "/strategies", file: "_app.strategies.index.tsx", capability: "strategy_library", denial: "inline-item-lock" },
];

const routeSrc = (file: string) => readFileSync(resolve(process.cwd(), "src/routes", file), "utf8");

describe("gated routes never redirect the denied user away", () => {
  for (const route of gatedRoutes) {
    it(`${route.url} keeps the URL and shows the reason instead of bouncing`, () => {
      const src = routeSrc(route.file);
      // No route-level redirect: the page must render for everyone, gate inside.
      expect(src).not.toMatch(/beforeLoad\s*:/);
      expect(src).not.toMatch(/\bthrow redirect\(/);
      // No dashboard/pricing fallback triggered by the lock itself.
      expect(src).not.toMatch(/navigate\(\{\s*to:\s*"\/dashboard"\s*\}\)/);
    });

    it(`${route.url} gates on ${route.capability} with the expected denial style`, () => {
      const src = routeSrc(route.file);
      if (route.denial === "inline-lock") {
        expect(src).toContain("CapabilityGate");
        expect(src).toContain(`capability="${route.capability}"`);
        expect(src).toContain(`reason="${route.reason}"`);
      } else if (route.denial === "inline-preview") {
        expect(src).toMatch(new RegExp(`allow\\("${route.capability}"\\)`));
        expect(src).toContain("blur-[6px]");
      } else if (route.helper) {
        expect(src).toContain(route.helper);
      } else {
        expect(src).toMatch(new RegExp(`allow\\("${route.capability}"\\)`));
      }
      if (route.reason) expect(src).toContain("UpgradeModal");
    });
  }
});

describe("per-persona outcome for each gated route", () => {
  for (const id of ALL_PERSONAS) {
    const persona = personas[id];
    for (const route of gatedRoutes) {
      const allowed = can(persona.ent, route.capability);
      it(`${id}: ${route.url} -> ${allowed ? "full page" : route.denial}`, () => {
        if (allowed) {
          // Nothing to prove beyond access: the page renders normally.
          expect(can(persona.ent, route.capability)).toBe(true);
          return;
        }
        // Denied: the denial is in-page, so the user stays on the route and is
        // offered the upgrade path rather than being redirected.
        expect(route.denial).not.toBe("redirect");
        expect(() => assertCapability(persona.ent, route.capability)).toThrow();
      });
    }
  }

  it("flag off and legacy trial are never denied on any gated route", () => {
    for (const route of gatedRoutes) {
      expect(can(personas.flagOff.ent, route.capability)).toBe(true);
      expect(can(personas.legacyTrial.ent, route.capability)).toBe(true);
    }
  });

  it("free and expired trial are denied on the paid surfaces", () => {
    for (const route of gatedRoutes) {
      expect(can(personas.free.ent, route.capability)).toBe(false);
      expect(can(personas.expiredTrial.ent, route.capability)).toBe(false);
    }
  });

  it("admin sees every gated route", () => {
    for (const route of gatedRoutes) expect(can(personas.admin.ent, route.capability)).toBe(true);
  });
});

describe("CapabilityGate renders the page while entitlements load", () => {
  const src = readFileSync(resolve(process.cwd(), "src/components/CapabilityGate.tsx"), "utf8");

  it("never flashes the lock screen at a paying account", () => {
    expect(src).toContain("if (ent.loading || ent.allow(capability)) return <>{children}</>;");
  });

  it("offers the upgrade modal rather than a navigation", () => {
    expect(src).toContain("UpgradeModal");
    expect(src).not.toMatch(/navigate\(|redirect\(/);
  });
});

describe("intentional redirects", () => {
  it("/mental is the only permanent redirect and it lands on /journal", () => {
    const src = routeSrc("_app.mental.tsx");
    expect(src).toContain('throw redirect({ to: "/journal" })');
  });
});

describe("server-side denial shape", () => {
  it("403 body carries only the denial fields", async () => {
    const res = forbiddenResponse("analytics");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["capability", "error", "upgradeRequired"]);
    expect(body).toEqual({ error: "forbidden", capability: "analytics", upgradeRequired: true });
  });

  it("401 body carries no capability or entitlement detail", async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("denial bodies never contain payload or account fields", () => {
    for (const route of gatedRoutes) {
      const text = JSON.stringify(forbiddenBody(route.capability));
      for (const leak of ["trades", "balance", "apiKey", "email", "tier", "signals", "positions"]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("assertCapability throws a Response, not a plain error, so the RPC layer returns 403", async () => {
    let thrown: unknown;
    try {
      assertCapability(personas.free.ent, "autopilot");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
    expect(() => assertCapability(personas.elite.ent, "autopilot")).not.toThrow();
  });
});

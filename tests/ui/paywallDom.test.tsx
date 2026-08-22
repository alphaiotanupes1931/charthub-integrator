// DOM regression tests for the paywall and locked-state UI.
//
// The access matrix proves who is allowed in; this suite proves the screen a
// denied account actually gets: the lock overlay renders, the copy names the
// right plan, the primary call to action points at /pricing, and the page
// content behind the lock is genuinely not in the DOM (not merely hidden with
// CSS, which would ship paid data to a free account).
//
// Components are rendered to markup with react-dom/server, so no browser is
// needed and the assertions are stable against styling changes — everything is
// keyed off data-testid hooks and visible copy.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveEntitlements, can, type Capability, type Entitlements } from "@/lib/entitlements";

// Router Link -> plain anchor so the modal renders outside a router context.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: never & { to: string; children?: unknown }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ type: "a", props: { href: to, ...(rest as object), children }, key: null, $$typeof: Symbol.for("react.element") }) as never,
}));

const entState: { value: Entitlements; loading: boolean } = {
  value: resolveEntitlements({ flagEnabled: true, subscription: null, now: new Date("2026-08-22T18:00:00Z") }),
  loading: false,
};

vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({
    loading: entState.loading,
    snapshot: { entitlements: entState.value },
    entitlements: entState.value,
    allow: (c: Capability) => can(entState.value, c),
  }),
}));

const { CapabilityGate } = await import("@/components/CapabilityGate");
const { UpgradeModal } = await import("@/components/UpgradeModal");

const NOW = new Date("2026-08-22T18:00:00Z");
const FUTURE = "2026-08-30T00:00:00Z";
const PAST = "2026-08-01T00:00:00Z";

const personas = {
  free: resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW }),
  expiredTrial: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: "pro", trialEnd: PAST }, now: NOW }),
  legacyTrial: resolveEntitlements({ flagEnabled: true, subscription: { status: "trialing", tier: null, trialEnd: FUTURE }, now: NOW }),
  pro: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "pro", trialEnd: null }, now: NOW }),
  elite: resolveEntitlements({ flagEnabled: true, subscription: { status: "active", tier: "elite", trialEnd: null }, now: NOW }),
  admin: resolveEntitlements({ flagEnabled: true, subscription: null, isAdmin: true, now: NOW }),
  flagOff: resolveEntitlements({ flagEnabled: false, subscription: null, now: NOW }),
} satisfies Record<string, Entitlements>;

type PersonaId = keyof typeof personas;
const ALL: PersonaId[] = ["free", "expiredTrial", "legacyTrial", "pro", "elite", "admin", "flagOff"];

const PAID_CONTENT = "PAID-CONTENT-SENTINEL";

/** Renders the gate the way the real pages do, for one persona. */
function renderGate(
  persona: PersonaId,
  gate: { capability: Capability; reason: "signals" | "autopilot"; title: string; body: string },
  { loading = false } = {},
) {
  entState.value = personas[persona];
  entState.loading = loading;
  return renderToStaticMarkup(
    <CapabilityGate capability={gate.capability} reason={gate.reason} title={gate.title} body={gate.body}>
      <div>{PAID_CONTENT}</div>
    </CapabilityGate>,
  );
}

// The two whole-page locks, with the copy the routes actually pass.
const pageGates = [
  {
    url: "/signals",
    capability: "signal_engine" as Capability,
    reason: "signals" as const,
    title: "The signal engine is part of the paid plan",
    body: "Scanned setups across every instrument, with the strategy win rates behind them.",
  },
  {
    url: "/autopilot",
    capability: "autopilot" as Capability,
    reason: "autopilot" as const,
    title: "Autopilot is part of the Elite plan",
    body: "Send graded setups straight to your broker with your own risk rails in place.",
  },
];

beforeEach(() => {
  entState.loading = false;
});

describe("locked page overlay matches the entitlement matrix", () => {
  for (const gate of pageGates) {
    for (const persona of ALL) {
      const allowed = can(personas[persona], gate.capability);
      it(`${persona}: ${gate.url} renders ${allowed ? "the page" : "the lock overlay"}`, () => {
        const html = renderGate(persona, gate);

        if (allowed) {
          expect(html).toContain(PAID_CONTENT);
          expect(html).not.toContain('data-testid="capability-lock"');
          return;
        }

        // Overlay present and tagged with the capability it is gating.
        expect(html).toContain('data-testid="capability-lock"');
        expect(html).toContain(`data-capability="${gate.capability}"`);
        // Messaging comes from the route, not a generic string.
        expect(html).toContain(gate.title);
        expect(html).toContain(gate.body);
        // Single call to action, and it opens the upgrade modal (not a redirect).
        expect(html).toContain('data-testid="lock-cta"');
        expect(html).toContain("See plans");
        // Critical: the paid content is absent from the markup, not just hidden.
        expect(html).not.toContain(PAID_CONTENT);
        expect(html).not.toMatch(/display:\s*none/);
      });
    }
  }

  it("renders the page (never a flash of the lock) while entitlements load", () => {
    const html = renderGate("free", pageGates[0]!, { loading: true });
    expect(html).toContain(PAID_CONTENT);
    expect(html).not.toContain('data-testid="capability-lock"');
  });

  it("the modal is closed until the call to action is pressed", () => {
    const html = renderGate("free", pageGates[0]!);
    expect(html).not.toContain('data-testid="upgrade-modal"');
  });
});

describe("upgrade modal copy and calls to action", () => {
  const reasons = ["grades", "analytics", "coaches", "signals", "autopilot", "academy", "broker"] as const;

  for (const reason of reasons) {
    it(`${reason}: has a headline, body, upgrade CTA and a stay-free escape hatch`, () => {
      const html = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason={reason} />);
      expect(html).toContain(`data-reason="${reason}"`);
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');

      const title = html.match(/data-testid="upgrade-title"[^>]*>([^<]+)</)?.[1] ?? "";
      const body = html.match(/data-testid="upgrade-body"[^>]*>([^<]+)</)?.[1] ?? "";
      expect(title.length).toBeGreaterThan(10);
      expect(body.length).toBeGreaterThan(30);

      expect(html).toContain('data-testid="upgrade-primary-cta"');
      expect(html).toContain('href="/pricing"');
      expect(html).toContain('data-testid="upgrade-secondary-cta"');
      expect(html).toContain("Keep using the free plan");
      // Never a dead end and never a dark pattern: closing is always offered.
      expect(html).toContain('aria-label="Close"');
    });
  }

  it("names Elite for Autopilot and the paid plan elsewhere", () => {
    const autopilot = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason="autopilot" />);
    expect(autopilot).toMatch(/Elite plan/);
    for (const reason of ["analytics", "signals", "coaches", "academy", "broker"] as const) {
      const html = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason={reason} />);
      expect(html).toMatch(/part of the paid plan/);
      expect(html).not.toMatch(/Elite plan/);
    }
  });

  it("grade exhaustion shows the used-of-limit counter and the reset promise", () => {
    const html = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason="grades" used={3} limit={3} />);
    expect(html).toContain("3 of 3 used this month");
    expect(html).toMatch(/reset|come back on the 1st/i);
  });

  it("reassures that free surfaces stay free", () => {
    const grades = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason="grades" />);
    expect(grades).toMatch(/journal/i);
    expect(grades).toMatch(/risk calculator/i);
    const academy = renderToStaticMarkup(<UpgradeModal open onClose={() => {}} reason="academy" />);
    expect(academy).toMatch(/free forever/i);
  });

  it("renders nothing at all when closed", () => {
    expect(renderToStaticMarkup(<UpgradeModal open={false} onClose={() => {}} reason="analytics" />)).toBe("");
  });
});

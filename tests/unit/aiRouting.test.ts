import { describe, expect, it } from "vitest";
import { normalizeModelPref, resolveChatModel } from "@/lib/ai-routing";

describe("normalizeModelPref", () => {
  it("keeps the two explicit pins and defaults everything else to auto", () => {
    expect(normalizeModelPref("claude")).toBe("claude");
    expect(normalizeModelPref("fallback")).toBe("fallback");
    expect(normalizeModelPref("auto")).toBe("auto");
    expect(normalizeModelPref(undefined)).toBe("auto");
    expect(normalizeModelPref(null)).toBe("auto");
    expect(normalizeModelPref("CLAUDE")).toBe("auto");
    expect(normalizeModelPref(7)).toBe("auto");
  });
});

describe("resolveChatModel", () => {
  it("auto accounts use Claude while it is healthy", () => {
    expect(resolveChatModel({ pref: "auto", hasKey: true, claudeHealthy: true })).toEqual({
      useClaude: true,
      reason: "auto_healthy",
    });
  });

  it("auto accounts fall back when Claude fails the health check", () => {
    expect(resolveChatModel({ pref: "auto", hasKey: true, claudeHealthy: false })).toEqual({
      useClaude: false,
      reason: "auto_unhealthy",
    });
  });

  it("a pinned account stays on Claude even when the probe says unhealthy", () => {
    expect(resolveChatModel({ pref: "claude", hasKey: true, claudeHealthy: false })).toEqual({
      useClaude: true,
      reason: "pinned_claude",
    });
  });

  it("a pinned fallback account never uses Claude, healthy or not", () => {
    for (const claudeHealthy of [true, false]) {
      expect(resolveChatModel({ pref: "fallback", hasKey: true, claudeHealthy })).toEqual({
        useClaude: false,
        reason: "pinned_fallback",
      });
    }
  });

  it("no stored key always routes to the backup model, including for pinned accounts", () => {
    expect(resolveChatModel({ pref: "claude", hasKey: false, claudeHealthy: true })).toEqual({
      useClaude: false,
      reason: "no_key",
    });
    expect(resolveChatModel({ pref: "auto", hasKey: false, claudeHealthy: false })).toEqual({
      useClaude: false,
      reason: "no_key",
    });
  });

  it("one account's pin never changes another account's route", () => {
    const marcus = resolveChatModel({ pref: "claude", hasKey: true, claudeHealthy: false });
    const everyoneElse = resolveChatModel({ pref: "auto", hasKey: true, claudeHealthy: false });
    expect(marcus.useClaude).toBe(true);
    expect(everyoneElse.useClaude).toBe(false);
  });
});

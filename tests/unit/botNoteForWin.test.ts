import { describe, expect, it } from "vitest";
import { botNoteForWin, type BotProposalRow } from "@/lib/retention-emails.shared";

const row = (o: Partial<BotProposalRow>): BotProposalRow => ({
  symbol: "NAS100", side: "long", status: "expired", rejection_reason: null, created_at: "2026-11-09T15:00:00Z", ...o,
});

describe("scanner wins email: what the bot did", () => {
  it("says taken when any matching proposal was placed", () => {
    expect(botNoteForWin({ symbol: "NAS100", bias: "Long" }, [row({}), row({ status: "approved" })]))
      .toBe("Your auto trader took this trade.");
  });
  it("gives the block reason", () => {
    expect(botNoteForWin({ symbol: "GBP/USD", bias: "Long" }, [row({ symbol: "GBP/USD", status: "blocked", rejection_reason: "Grade C is below your B minimum" })]))
      .toBe("Skipped: Grade C is below your B minimum.");
  });
  it("explains an unfilled pullback entry", () => {
    expect(botNoteForWin({ symbol: "NAS100", bias: "Long" }, [row({})])).toMatch(/pull back/);
  });
  it("ignores the opposite direction", () => {
    expect(botNoteForWin({ symbol: "NAS100", bias: "Short" }, [row({ status: "approved" })]))
      .toBe("Your auto trader did not have this one on its list.");
  });
  it("says auto trading is off when the trader has no proposals", () => {
    expect(botNoteForWin({ symbol: "NAS100", bias: "Long" }, [])).toBe("Auto trading is off for your account.");
  });
});

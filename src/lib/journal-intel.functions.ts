// Journal intelligence: correlate mental state against realised P&L in code,
// then have the coach name the recurring mistakes it can see in the log.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TradeInput = z.object({
  date: z.string().max(40),
  symbol: z.string().max(30),
  side: z.string().max(12).optional(),
  pnl: z.coerce.number().optional(),
  rr: z.coerce.number().optional(),
  grade: z.string().max(12).optional(),
  session: z.string().max(30).optional(),
  notes: z.string().max(600).optional(),
  followedPlan: z.boolean().optional(),
});

const MentalInput = z.object({
  date: z.string().max(40),
  score: z.coerce.number(),
  mood: z.string().max(300).optional(),
});

const ReviewInput = z.object({
  trades: z.array(TradeInput).max(300),
  mental: z.array(MentalInput).max(300).default([]),
});

export type JournalReview = {
  summary: string;
  mistakes: string[];
  strengths: string[];
  correlations: {
    byMentalScore: { score: number; trades: number; netPnl: number; winRate: number }[];
    calmVsRushed: { calmNetPnl: number; rushedNetPnl: number } | null;
    bestSession: string | null;
    worstSession: string | null;
  };
  tradeCount: number;
  createdAt: string;
};

export const reviewJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReviewInput.parse(raw))
  .handler(async ({ data, context }): Promise<JournalReview> => {
    const trades = data.trades.filter((t) => Number.isFinite(t.pnl ?? NaN));
    const mentalByDate = new Map(data.mental.map((m) => [m.date.slice(0, 10), m.score]));

    // Correlation maths stay deterministic in code; the model only narrates.
    const buckets = new Map<number, { trades: number; netPnl: number; wins: number }>();
    for (const t of trades) {
      const score = mentalByDate.get(t.date.slice(0, 10));
      if (score == null) continue;
      const key = Math.round(score);
      const b = buckets.get(key) ?? { trades: 0, netPnl: 0, wins: 0 };
      b.trades += 1;
      b.netPnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) b.wins += 1;
      buckets.set(key, b);
    }
    const byMentalScore = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([score, b]) => ({
        score,
        trades: b.trades,
        netPnl: Math.round(b.netPnl * 100) / 100,
        winRate: b.trades ? Math.round((b.wins / b.trades) * 1000) / 10 : 0,
      }));

    const calm = byMentalScore.filter((r) => r.score >= 4).reduce((s, r) => s + r.netPnl, 0);
    const rushed = byMentalScore.filter((r) => r.score <= 2).reduce((s, r) => s + r.netPnl, 0);

    const sessions = new Map<string, number>();
    for (const t of trades) {
      if (!t.session) continue;
      sessions.set(t.session, (sessions.get(t.session) ?? 0) + (t.pnl ?? 0));
    }
    const sessionRows = [...sessions.entries()].sort((a, b) => b[1] - a[1]);

    const correlations: JournalReview["correlations"] = {
      byMentalScore,
      calmVsRushed: byMentalScore.length
        ? { calmNetPnl: Math.round(calm * 100) / 100, rushedNetPnl: Math.round(rushed * 100) / 100 }
        : null,
      bestSession: sessionRows[0]?.[0] ?? null,
      worstSession: sessionRows.length > 1 ? sessionRows[sessionRows.length - 1]![0] : null,
    };

    let summary = "Not enough logged trades yet to find a pattern. Log at least five closed trades with a mental-state score.";
    let mistakes: string[] = [];
    let strengths: string[] = [];

    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey && trades.length >= 5) {
      const { generateText, Output, NoObjectGeneratedError } = await import("ai");
      const { createAiGatewayProvider } = await import("@/lib/ai-gateway.server");
      const Schema = z.object({
        summary: z.string(),
        mistakes: z.array(z.string()),
        strengths: z.array(z.string()),
      });
      const rows = trades
        .slice(-120)
        .map(
          (t) =>
            `${t.date} ${t.symbol} ${t.side ?? ""} pnl=${t.pnl ?? 0} rr=${t.rr ?? ""} grade=${t.grade ?? ""} session=${t.session ?? ""} plan=${t.followedPlan === undefined ? "" : t.followedPlan ? "followed" : "broken"} note=${(t.notes ?? "").slice(0, 160)}`,
        )
        .join("\n");
      const stats = JSON.stringify(correlations);
      try {
        const res = await generateText({
          model: createAiGatewayProvider(apiKey)("google/gemini-3-flash-preview"),
          output: Output.object({ schema: Schema }),
          system:
            "You are a trading performance reviewer. Read the trade log and the pre-computed correlation stats and report what the trader is actually doing wrong and right. Be concrete and quote symbols, sessions, grades and numbers from the data. Never invent numbers that are not derivable from the log. Keep the summary under 700 characters. Give at most 5 mistakes and at most 4 strengths, each one sentence, plain language, no emoji, no marketing tone.",
          prompt: `Correlation stats (already computed, trust these): ${stats}\n\nTrade log:\n${rows}`,
        });
        summary = res.output.summary.slice(0, 1200);
        mistakes = res.output.mistakes.slice(0, 5).map((m) => m.slice(0, 300));
        strengths = res.output.strengths.slice(0, 4).map((m) => m.slice(0, 300));
      } catch (e) {
        if (NoObjectGeneratedError.isInstance(e)) {
          summary = "The reviewer returned an unreadable response. The correlation numbers below are still accurate.";
        } else {
          summary = "The review service is unavailable right now. The correlation numbers below are still accurate.";
        }
      }
    }

    const createdAt = new Date().toISOString();
    await context.supabase.from("journal_reviews").insert({
      user_id: context.userId,
      summary,
      mistakes,
      strengths,
      correlations: correlations as never,
      trade_count: trades.length,
    });

    return { summary, mistakes, strengths, correlations, tradeCount: trades.length, createdAt };
  });

export const latestJournalReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JournalReview | null> => {
    const { data } = await context.supabase
      .from("journal_reviews")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      summary: data.summary as string,
      mistakes: (data.mistakes as string[]) ?? [],
      strengths: (data.strengths as string[]) ?? [],
      correlations: data.correlations as JournalReview["correlations"],
      tradeCount: Number(data.trade_count),
      createdAt: data.created_at as string,
    };
  });

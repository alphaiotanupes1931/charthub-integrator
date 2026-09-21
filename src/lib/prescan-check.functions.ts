import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Coach feedback on the pre-scan checklist. The right answers are already
 * known in code and shown regardless; this call only adds the teaching part -
 * what the trader got wrong and what to do about it. Runs on Claude first with
 * the gateway model as the fallback, same routing as scans and chat.
 */

const Input = z.object({
  modelName: z.string().max(80),
  symbol: z.string().max(40).optional(),
  timeframe: z.string().max(20).optional(),
  answers: z
    .array(
      z.object({
        question: z.string().max(400),
        chosen: z.string().max(300),
        correct: z.string().max(300),
        why: z.string().max(600),
        wasCorrect: z.boolean(),
      }),
    )
    .min(1)
    .max(5),
});

export const reviewPreScanAnswers = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data }) => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    const correctCount = data.answers.filter((a) => a.wasCorrect).length;
    const fallback = data.answers
      .map((a) => `${a.wasCorrect ? "Correct" : "Not quite"} — ${a.correct}. ${a.why}`)
      .join("\n\n");

    if (!apiKey) return { feedback: fallback, model: "offline" as const, correctCount };

    const system = [
      "You are a trading coach on a teaching platform, reviewing a short pre-scan checklist.",
      "Be direct, warm and brief. No emojis, no lists of praise, no filler.",
      "For each item the trader got wrong, explain in one or two plain sentences why the right answer is right and what to do differently on the chart.",
      "For items they got right, one short line confirming the reasoning is enough.",
      "Finish with a single sentence on what to watch for on this scan.",
      "Never invent prices, levels or grades. Total under 160 words.",
    ].join(" ");

    const user = [
      `Scan model: ${data.modelName}`,
      data.symbol ? `Instrument: ${data.symbol}` : "",
      data.timeframe ? `Timeframe: ${data.timeframe}` : "",
      "",
      ...data.answers.map(
        (a, i) =>
          `Q${i + 1}: ${a.question}\nTheir answer: ${a.chosen}\nCorrect answer: ${a.correct}\nReason: ${a.why}\nResult: ${a.wasCorrect ? "correct" : "wrong"}`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const { generateText } = await import("ai");
      const { runScanModel } = await import("@/lib/agents/scan-model.server");
      const out = await runScanModel(apiKey, async (model, label) => {
        const r = await generateText({ model, system, prompt: user });
        return { text: r.text?.trim() ?? "", label };
      });
      if (!out.text) return { feedback: fallback, model: "offline" as const, correctCount };
      return { feedback: out.text, model: out.label, correctCount };
    } catch {
      return { feedback: fallback, model: "offline" as const, correctCount };
    }
  });

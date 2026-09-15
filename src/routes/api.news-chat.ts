// Dedicated chat endpoint for the news / economic calendar page. Same feed the
// briefings use, but the model is told to answer questions about the releases
// and the session read only - no setup grading, no chart drawing.
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import {
  corsHeadersFor,
  enforceMaxBody,
  enforceOrigin,
  getOrCreateRequestId,
  preflight,
} from "@/lib/api-security";
import type { Database } from "@/integrations/supabase/types";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const FALLBACK_MODEL = "google/gemini-2.5-flash";

type NewsChatBody = {
  messages?: UIMessage[];
  writeup?: string | null;
  watchlist?: string[];
};

function systemPrompt(calendar: string | undefined, writeup: string | null | undefined, watchlist: string[]): string {
  return [
    "You are TradeMind's news desk. You explain economic releases, central bank policy, and how the calendar is likely to move price. You are not grading setups here; if the trader wants a setup graded, point them to the AI coach on the dashboard.",
    "Rules: answer in 3-6 sentences, plain English, no jargon without a one-line definition, no emojis, no dashes for emphasis. Always tie the answer back to what it means for price and for risk today (position size, whether to be flat into a release). If the calendar block does not contain the release the trader is asking about, say so instead of inventing numbers.",
    "When you explain a print, cover three things: what the number measures, whether it came in above or below forecast and why that matters, and the practical takeaway for the instruments the trader watches.",
    watchlist.length ? `The trader watches: ${watchlist.join(", ")}.` : "",
    writeup ? `CURRENT SESSION READ SHOWN ON THEIR SCREEN:\n${writeup}` : "",
    calendar ? calendar : "No economic calendar data was available on this request; say so plainly if asked about specific releases.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const Route = createFileRoute("/api/news-chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      POST: async ({ request }) => {
        const reqId = getOrCreateRequestId(request);
        const originBlock = enforceOrigin(request);
        if (originBlock) return originBlock;
        const tooBig = enforceMaxBody(request, 512 * 1024);
        if (tooBig) return tooBig;
        const cors = { ...corsHeadersFor(request), "X-Request-Id": reqId };

        let body: NewsChatBody;
        try {
          body = (await request.json()) as NewsChatBody;
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: cors });
        }
        const messages = body.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          return new Response("messages required", { status: 400, headers: cors });
        }

        // The news page lives behind auth, so require a real session here too.
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token || token.split(".").length !== 3) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }
        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          },
        );
        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        const userId = claims?.claims?.sub ?? null;
        if (claimsErr || !userId) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }

        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const gatewayKey = process.env.LOVABLE_API_KEY;
        if (!anthropicKey && !gatewayKey) {
          return new Response("The news desk is temporarily unavailable. Please try again shortly.", {
            status: 503,
            headers: cors,
          });
        }

        const watchlist = (body.watchlist ?? []).filter((s) => typeof s === "string").slice(0, 20);
        let calendar: string | undefined;
        try {
          const { calendarContextBlock } = await import("@/lib/news.server");
          calendar = await calendarContextBlock(watchlist[0]);
        } catch (e) {
          console.warn(`[news-chat] req=${reqId} calendar_failed`, (e as Error).message);
        }
        // No feed means NO news: never let the model answer from training data.
        if (!calendar) {
          calendar = [
            "ECONOMIC CALENDAR: no live calendar data is available for this request.",
            "Say plainly that the calendar feed is unavailable right now. Never name a release, time, forecast or actual figure from memory.",
          ].join("\n");
        }

        const model = anthropicKey
          ? (createAnthropic({ apiKey: anthropicKey })(CLAUDE_MODEL) as unknown as Parameters<typeof streamText>[0]["model"])
          : createAiGatewayProvider(gatewayKey!)(FALLBACK_MODEL);
        const activeModelId = anthropicKey ? CLAUDE_MODEL : FALLBACK_MODEL;

        const result = streamText({
          model,
          messages: [
            { role: "system", content: systemPrompt(calendar, body.writeup, watchlist) },
            ...(await convertToModelMessages(messages)),
          ],
          temperature: 0.4,
          maxOutputTokens: 1200,
          abortSignal: request.signal,
          onError: ({ error }) => {
            console.error(`[news-chat] req=${reqId} stream_error`, (error as Error)?.message ?? String(error));
          },
          onFinish: async ({ usage, providerMetadata }) => {
            try {
              const { logAiCost } = await import("@/lib/ai-cost.server");
              await logAiCost({ kind: "news-chat", model: activeModelId, usage, providerMetadata, userId });
            } catch { /* cost logging is never fatal */ }
          },
        });

        return result.toUIMessageStreamResponse({
          headers: { ...cors, "X-Request-Id": reqId },
          originalMessages: messages,
        });
      },
    },
  },
});

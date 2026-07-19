// Telegram webhook. Users message the bot with "/start CODE" to link their
// Telegram chat to their TradeMind account.
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

function deriveWebhookSecret(connKey: string): string {
  return createHash("sha256").update(`telegram-webhook:${connKey}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const l = Buffer.from(a);
  const r = Buffer.from(b);
  return l.length === r.length && timingSafeEqual(l, r);
}

type TgUpdate = {
  update_id?: number;
  message?: {
    chat?: { id?: number };
    from?: { id?: number; first_name?: string };
    text?: string;
  };
};

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const connKey = process.env.TELEGRAM_API_KEY;
        if (!connKey) return new Response("telegram_not_configured", { status: 503 });

        // Verify Telegram secret
        const expected = deriveWebhookSecret(connKey);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) return new Response("unauthorized", { status: 401 });

        const update = (await request.json().catch(() => ({}))) as TgUpdate;
        const msg = update.message;
        const chatId = msg?.chat?.id;
        const text = (msg?.text ?? "").trim();

        if (!chatId) return Response.json({ ok: true });

        // Handle /start CODE
        const startMatch = text.match(/^\/start\s+([A-Z0-9]{8,16})$/i);
        if (startMatch) {
          const code = startMatch[1].toUpperCase();
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { sendTelegramMessage } = await import("@/lib/briefings.server");
          const { data: row } = await supabaseAdmin
            .from("briefing_prefs")
            .select("user_id")
            .eq("telegram_link_code", code)
            .maybeSingle();
          if (!row) {
            await sendTelegramMessage(chatId, "That code is invalid or already used. Generate a new one in TradeMind → Settings.");
            return Response.json({ ok: true });
          }
          await supabaseAdmin
            .from("briefing_prefs")
            .update({ telegram_chat_id: chatId, telegram_link_code: null })
            .eq("user_id", row.user_id);
          await sendTelegramMessage(chatId, "Linked. You'll get morning and evening briefings here.");
          return Response.json({ ok: true });
        }

        if (/^\/start\b/i.test(text)) {
          const { sendTelegramMessage } = await import("@/lib/briefings.server");
          await sendTelegramMessage(chatId, "Welcome to TradeMind. Open Settings → Briefings in the app and copy the link code, then send /start CODE here.");
        }

        return Response.json({ ok: true });
      },
    },
  },
});

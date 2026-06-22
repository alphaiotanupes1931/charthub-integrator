import { createFileRoute } from "@tanstack/react-router";

type Body = { text?: string; voiceId?: string };

const VOICE_ID_TO_GATEWAY_VOICE: Record<string, string> = {
  JBFqnCBsd6RMkjVDRZzb: "echo",
  bIHbv24MWmeRgasZH58o: "ash",
  XrExE9yKIg1WjnnlVkGX: "coral",
  EXAVITQu4vr4xnSDxMaL: "sage",
};

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("TTS not configured", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const text = (body.text ?? "").toString().trim();
        const voiceId = (body.voiceId ?? "JBFqnCBsd6RMkjVDRZzb").toString();
        if (!text) return new Response("text required", { status: 400 });

        // Hard cap to control cost / latency. Long replies get truncated for voice.
        const clipped = text.length > 1200 ? text.slice(0, 1200) + "…" : text;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: clipped,
            voice: VOICE_ID_TO_GATEWAY_VOICE[voiceId] ?? "alloy",
            stream_format: "audio",
            response_format: "mp3",
            instructions: "Speak like a concise, confident trading coach. Keep the delivery warm and direct.",
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const err = await upstream.text().catch(() => "");
          console.error("[tts] upstream error", upstream.status, err);
          return new Response(err || "TTS failed", { status: upstream.status });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    },
  },
});

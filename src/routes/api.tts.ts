import { createFileRoute } from "@tanstack/react-router";

type Body = { text?: string; voiceId?: string };

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) return new Response("TTS not configured", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const text = (body.text ?? "").toString().trim();
        const voiceId = (body.voiceId ?? DEFAULT_VOICE).toString();
        if (!text) return new Response("text required", { status: 400 });

        const clipped = text.length > 1200 ? text.slice(0, 1200) + "…" : text;

        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: clipped,
              model_id: "eleven_turbo_v2_5",
              voice_settings: {
                stability: 0.45,
                similarity_boost: 0.8,
                style: 0.35,
                use_speaker_boost: true,
                speed: 1.0,
              },
            }),
          },
        );

        if (!upstream.ok || !upstream.body) {
          const err = await upstream.text().catch(() => "");
          console.error("[tts] elevenlabs error", upstream.status, err);
          return new Response(err || "TTS failed", { status: upstream.status });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    },
  },
});

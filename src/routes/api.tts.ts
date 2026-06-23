import { createFileRoute } from "@tanstack/react-router";
import {
  corsHeadersFor,
  enforceMaxBody,
  enforceOrigin,
  preflight,
  rateLimit,
} from "@/lib/api-security";


type Body = { text?: string; voiceId?: string };

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George

const GATEWAY_TTS_URL = ["https://ai.gateway", "lovable.dev", "v1/audio/speech"].join(".").replace(".v1", "/v1");

async function speakWithAiGateway(text: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(GATEWAY_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini-tts",
      input: text,
      voice: "alloy",
      stream_format: "audio",
      response_format: "mp3",
    }),
  });

  if (!response.ok || !response.body) {
    const err = await response.text().catch(() => "");
    console.error("[tts] gateway error", response.status, err);
    return null;
  }

  return new Response(response.body, {
    headers: { "Content-Type": "audio/mpeg" },
  });
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        const apiKey = process.env.ELEVENLABS_API_KEY_OVERRIDE || process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          const gatewayAudio = await speakWithAiGateway(clipped);
          return gatewayAudio ?? new Response("TTS not configured", { status: 500 });
        }

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
          const quotaBlocked = upstream.status === 401 || upstream.status === 402 || err.toLowerCase().includes("quota");
          if (quotaBlocked) {
            const gatewayAudio = await speakWithAiGateway(clipped);
            if (gatewayAudio) return gatewayAudio;
          }
          return new Response(err || "TTS failed", { status: upstream.status });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      },
    },
  },
});

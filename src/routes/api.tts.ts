import { createFileRoute } from "@tanstack/react-router";
import {
  corsHeadersFor,
  enforceMaxBody,
  enforceOrigin,
  getOrCreateRequestId,
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
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      POST: async ({ request }) => {
        const reqId = getOrCreateRequestId(request);
        const originBlock = enforceOrigin(request);
        if (originBlock) return originBlock;
        const tooBig = enforceMaxBody(request, 32 * 1024); // 32 KB cap for TTS text
        if (tooBig) return tooBig;
        const limited = rateLimit(request, { key: "tts", limit: 20, windowMs: 60_000 });
        if (limited) return limited;
        const cors = { ...corsHeadersFor(request), "X-Request-Id": reqId };
        console.log(`[tts] req=${reqId} start`);

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: cors });
        }
        const text = (body.text ?? "").toString().trim();
        const voiceId = (body.voiceId ?? DEFAULT_VOICE).toString();
        if (!text) return new Response("text required", { status: 400, headers: cors });

        const clipped = text.length > 1200 ? text.slice(0, 1200) + "…" : text;
        const apiKey = process.env.ELEVENLABS_API_KEY_OVERRIDE || process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          const gatewayAudio = await speakWithAiGateway(clipped);
          if (gatewayAudio) {
            const h = new Headers(gatewayAudio.headers);
            for (const [k, v] of Object.entries(cors)) h.set(k, v);
            return new Response(gatewayAudio.body, { headers: h });
          }
          return new Response("TTS not configured", { status: 500, headers: cors });
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
            if (gatewayAudio) {
              const h = new Headers(gatewayAudio.headers);
              for (const [k, v] of Object.entries(cors)) h.set(k, v);
              return new Response(gatewayAudio.body, { headers: h });
            }
          }
          return new Response(err || "TTS failed", { status: upstream.status, headers: cors });
        }

        return new Response(upstream.body, {
          headers: { "Content-Type": "audio/mpeg", ...cors },
        });
      },
    },
  },
});

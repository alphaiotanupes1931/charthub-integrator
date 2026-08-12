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

function emptyAudio(headers: Record<string, string>) {
  return new Response(null, {
    status: 204,
    headers: { ...headers, "X-TTS-Fallback": "browser" },
  });
}

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
        const cors = { ...corsHeadersFor(request), "X-Request-Id": reqId };
        console.log(`[tts] req=${reqId} start`);

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: cors });
        }
        const text = (body.text ?? "").toString().trim();
        if (!text) return new Response("text required", { status: 400, headers: cors });

        // Always use browser SpeechSynthesis (free, no API cost).
        // Client hook falls back to window.speechSynthesis on 204.
        return emptyAudio(cors);


      },
    },
  },
});

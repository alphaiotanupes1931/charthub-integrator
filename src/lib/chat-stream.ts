export function textFromUiMessageParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return (parts as Array<{ type?: string; text?: string; delta?: string }>)
    .map((part) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "text-delta") return part.delta ?? "";
      return "";
    })
    .join("");
}

export async function coalesceUiMessageStream(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream")) return response;

  const raw = await response.text();
  let text = "";
  let finishReason = "stop";

  for (const frame of raw.split(/\n\n+/)) {
    const dataLine = frame
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const data = dataLine.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data) as { type?: string; delta?: string; text?: string; finishReason?: string };
      if (event.type === "text-delta" && typeof event.delta === "string") text += event.delta;
      if (event.type === "text" && typeof event.text === "string") text += event.text;
      if (event.type === "finish" && typeof event.finishReason === "string") finishReason = event.finishReason;
    } catch {
      // Keep rendering resilient if a provider sends an unknown frame.
    }
  }

  if (!text.trim()) {
    return new Response(raw, { status: response.status, statusText: response.statusText, headers: response.headers });
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  const body = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "0" },
    { type: "text-delta", id: "0", delta: text },
    { type: "text-end", id: "0" },
    { type: "finish-step" },
    { type: "finish", finishReason },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("") + "data: [DONE]\n\n";

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
/**
 * Turns a raw chat API failure into copy a trader can act on. Cap responses
 * arrive as a JSON body, which the AI SDK surfaces as the error message.
 */
export function friendlyChatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    if (parsed?.message) return parsed.message;
  } catch {
    /* not a JSON body */
  }
  return raw || "AI request failed";
}

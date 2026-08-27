// Automated health check for the stored Anthropic key.
//
// Chat used to hand the key straight to Claude and only discover a bad key when
// a reply died mid-stream. This verifies the key with one tiny, cheap message
// call before chat is allowed to use Claude, classifies *why* it failed, and
// caches the verdict so we don't probe on every request.

const PROBE_MODEL = "claude-haiku-4-5-20251001";
const PROBE_TIMEOUT_MS = 6_000;

/** How long a failed verdict sticks before we re-probe. */
const FAIL_TTL_MS = 10 * 60 * 1000;
/** How long a healthy verdict is trusted. */
const OK_TTL_MS = 15 * 60 * 1000;

export type AnthropicHealthStatus =
  | "ok"
  | "not_configured"
  | "invalid_key"
  | "no_credits"
  | "no_model_access"
  | "rate_limited"
  | "unreachable";

export type AnthropicHealth = {
  ok: boolean;
  status: AnthropicHealthStatus;
  /** Short, human-readable reason suitable for surfacing in the UI. */
  detail: string;
  httpStatus: number | null;
  checkedAt: string;
  latencyMs: number;
  /** True when the verdict came from cache instead of a live call. */
  cached: boolean;
};

let cached: { value: AnthropicHealth; expiresAt: number; keyFingerprint: string } | null = null;
let inflight: Promise<AnthropicHealth> | null = null;

/** Last 6 chars only, so a key swap invalidates the cache without logging secrets. */
function fingerprint(key: string): string {
  return `${key.length}:${key.slice(-6)}`;
}

function classify(httpStatus: number, body: string): { status: AnthropicHealthStatus; detail: string } {
  const text = body.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403) {
    if (text.includes("credit")) {
      return { status: "no_credits", detail: "Anthropic rejected the key for billing reasons: add credits to the Claude account." };
    }
    return { status: "invalid_key", detail: "Anthropic rejected the key. Use a model key (sk-ant-api...), not an admin or billing key." };
  }
  if (httpStatus === 400 && (text.includes("credit") || text.includes("billing"))) {
    return { status: "no_credits", detail: "Anthropic rejected the key for billing reasons: add credits to the Claude account." };
  }
  if (httpStatus === 400 && (text.includes("model") || text.includes("not_found"))) {
    return { status: "no_model_access", detail: `The key cannot call ${PROBE_MODEL}. Check model access on the Claude account.` };
  }
  if (httpStatus === 404) {
    return { status: "no_model_access", detail: `${PROBE_MODEL} is not available to this key.` };
  }
  if (httpStatus === 429) {
    return { status: "rate_limited", detail: "Claude is rate limiting this key right now." };
  }
  return { status: "unreachable", detail: `Claude returned HTTP ${httpStatus}.` };
}

async function probe(key: string): Promise<AnthropicHealth> {
  const startedAt = Date.now();
  const finish = (status: AnthropicHealthStatus, detail: string, httpStatus: number | null): AnthropicHealth => ({
    ok: status === "ok",
    status,
    detail,
    httpStatus,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    cached: false,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
    });
    if (res.ok) return finish("ok", "Claude key verified.", res.status);
    const body = await res.text().catch(() => "");
    const { status, detail } = classify(res.status, body);
    console.warn(`[anthropic-health] ${status} http=${res.status} ${body.slice(0, 200)}`);
    return finish(status, detail, res.status);
  } catch (e) {
    const message = (e as Error)?.name === "AbortError" ? "Claude did not answer the health check in time." : (e as Error)?.message ?? "unknown error";
    console.warn(`[anthropic-health] unreachable ${message}`);
    return finish("unreachable", message, null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the stored Anthropic key can actually call Claude.
 * Cached per key value; pass `force` to bypass the cache.
 */
export async function checkAnthropicHealth(opts: { force?: boolean } = {}): Promise<AnthropicHealth> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: "not_configured",
      detail: "No Anthropic key is stored, so chat runs on the fallback model.",
      httpStatus: null,
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      cached: false,
    };
  }

  const fp = fingerprint(key);
  if (!opts.force && cached && cached.keyFingerprint === fp && Date.now() < cached.expiresAt) {
    return { ...cached.value, cached: true };
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const value = await probe(key);
    cached = {
      value,
      keyFingerprint: fp,
      expiresAt: Date.now() + (value.ok ? OK_TTL_MS : FAIL_TTL_MS),
    };
    return value;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Gate used by chat: only route to Claude when the key passes the health check. */
export async function anthropicUsable(): Promise<boolean> {
  return (await checkAnthropicHealth()).ok;
}

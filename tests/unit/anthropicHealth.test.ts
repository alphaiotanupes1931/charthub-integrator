import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChatModel } from "@/lib/ai-routing";

// Each test re-imports the module so the in-process health cache starts empty.
async function freshHealth() {
  vi.resetModules();
  return import("@/lib/anthropic-health.server");
}

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const origKey = process.env.ANTHROPIC_API_KEY;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-api-test-aaaaaa";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = origKey;
});

describe("Claude health check — failure classification", () => {
  it("reports ok on a successful probe", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(200, "{}"));
    const h = await checkAnthropicHealth();
    expect(h).toMatchObject({ ok: true, status: "ok", httpStatus: 200, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected key as invalid_key", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(401, '{"error":{"message":"invalid x-api-key"}}'));
    const h = await checkAnthropicHealth();
    expect(h.ok).toBe(false);
    expect(h.status).toBe("invalid_key");
  });

  it("classifies a billing rejection as no_credits", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(403, '{"error":{"message":"credit balance is too low"}}'));
    expect((await checkAnthropicHealth()).status).toBe("no_credits");
  });

  it("classifies a missing model as no_model_access", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(404, "not_found: model"));
    expect((await checkAnthropicHealth()).status).toBe("no_model_access");

    const second = await freshHealth();
    fetchMock.mockResolvedValue(response(400, '{"error":{"message":"model: unknown"}}'));
    expect((await second.checkAnthropicHealth()).status).toBe("no_model_access");
  });

  it("classifies throttling as rate_limited", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(429, "rate_limit_error"));
    expect((await checkAnthropicHealth()).status).toBe("rate_limited");
  });

  it("classifies a network failure or timeout as unreachable", async () => {
    const net = await freshHealth();
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const h = await net.checkAnthropicHealth();
    expect(h).toMatchObject({ ok: false, status: "unreachable", httpStatus: null });

    const timedOut = await freshHealth();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    const t = await timedOut.checkAnthropicHealth();
    expect(t.status).toBe("unreachable");
    expect(t.detail).toMatch(/in time/i);
  });

  it("reports not_configured with no probe when no key is stored", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { checkAnthropicHealth } = await freshHealth();
    const h = await checkAnthropicHealth();
    expect(h).toMatchObject({ ok: false, status: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Claude health check — caching", () => {
  it("serves a healthy verdict from cache instead of re-probing", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(200, "{}"));
    await checkAnthropicHealth();
    const second = await checkAnthropicHealth();
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches failures too, so a broken key does not probe on every message", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValue(response(401, "invalid x-api-key"));
    await checkAnthropicHealth();
    const second = await checkAnthropicHealth();
    expect(second).toMatchObject({ ok: false, status: "invalid_key", cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("force bypasses the cache", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValueOnce(response(401, "invalid x-api-key"));
    expect((await checkAnthropicHealth()).ok).toBe(false);
    fetchMock.mockResolvedValueOnce(response(200, "{}"));
    const forced = await checkAnthropicHealth({ force: true });
    expect(forced).toMatchObject({ ok: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-probes after the key is swapped", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    fetchMock.mockResolvedValueOnce(response(401, "invalid x-api-key"));
    expect((await checkAnthropicHealth()).status).toBe("invalid_key");

    process.env.ANTHROPIC_API_KEY = "sk-ant-api-test-zzzzzz";
    fetchMock.mockResolvedValueOnce(response(200, "{}"));
    const after = await checkAnthropicHealth();
    expect(after).toMatchObject({ ok: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("expires a failed verdict after its TTL and probes again", async () => {
    vi.useFakeTimers();
    try {
      const { checkAnthropicHealth } = await freshHealth();
      fetchMock.mockResolvedValueOnce(response(429, "rate_limit_error"));
      expect((await checkAnthropicHealth()).status).toBe("rate_limited");

      vi.advanceTimersByTime(9 * 60 * 1000);
      expect((await checkAnthropicHealth()).cached).toBe(true);

      vi.advanceTimersByTime(2 * 60 * 1000);
      fetchMock.mockResolvedValueOnce(response(200, "{}"));
      const revived = await checkAnthropicHealth();
      expect(revived).toMatchObject({ ok: true, cached: false });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses concurrent checks into a single probe", async () => {
    const { checkAnthropicHealth } = await freshHealth();
    let release: (() => void) | null = null;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { release = () => resolve(response(200, "{}")); }),
    );
    const all = Promise.all([checkAnthropicHealth(), checkAnthropicHealth(), checkAnthropicHealth()]);
    await vi.waitFor(() => expect(release).toBeTruthy());
    release!();
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("failure -> routing behavior", () => {
  it("an unhealthy Claude moves auto accounts to the backup model but not pinned ones", async () => {
    const { anthropicUsable } = await freshHealth();
    fetchMock.mockResolvedValue(response(401, "invalid x-api-key"));
    const healthy = await anthropicUsable();
    expect(healthy).toBe(false);

    expect(resolveChatModel({ pref: "auto", hasKey: true, claudeHealthy: healthy }).useClaude).toBe(false);
    expect(resolveChatModel({ pref: "claude", hasKey: true, claudeHealthy: healthy }).useClaude).toBe(true);
  });

  it("a healthy Claude serves auto accounts and leaves fallback pins alone", async () => {
    const { anthropicUsable } = await freshHealth();
    fetchMock.mockResolvedValue(response(200, "{}"));
    const healthy = await anthropicUsable();
    expect(healthy).toBe(true);

    expect(resolveChatModel({ pref: "auto", hasKey: true, claudeHealthy: healthy }).useClaude).toBe(true);
    expect(resolveChatModel({ pref: "fallback", hasKey: true, claudeHealthy: healthy }).useClaude).toBe(false);
  });
});

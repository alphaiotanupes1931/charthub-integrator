// Shared security helpers for /api/* server routes.
// - Origin allow-list (CORS lock)
// - Per-IP rate limiting (in-memory, best-effort)
// - Body size cap
// - Strong password schema

import { z } from "zod";

// ---- Allowed origins ------------------------------------------------------
// Production domain + Lovable preview hosts. Same-origin requests have no
// Origin header in many browsers, so we also allow missing Origin.
const ALLOWED_ORIGINS = new Set<string>([
  "https://trademindaicoach.com",
  "https://www.trademindaicoach.com",
]);

const ALLOWED_ORIGIN_SUFFIXES = [
  ".trademindaicoach.com",
  ".lovable.app", // preview + published mirror
  ".lovableproject.com", // legacy preview
];

function originAllowed(origin: string | null, host: string | null): boolean {
  if (!origin) return true; // same-origin browser request, server-to-server, curl
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Same host = same origin -> always fine.
  if (host && url.host === host) return true;
  if (ALLOWED_ORIGINS.has(`${url.protocol}//${url.host}`)) return true;
  if (ALLOWED_ORIGIN_SUFFIXES.some((s) => url.hostname.endsWith(s))) return true;
  // localhost for dev
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  return false;
}

// ---- Request ID -----------------------------------------------------------
// Honor an inbound X-Request-Id if it looks safe, otherwise mint one.
const SAFE_REQ_ID = /^[A-Za-z0-9._-]{8,128}$/;
export function getOrCreateRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  if (incoming && SAFE_REQ_ID.test(incoming)) return incoming;
  // crypto.randomUUID is available in Workers + modern Node
  return (globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Request-Id",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && originAllowed(origin, request.headers.get("host"))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!originAllowed(origin, host)) {
    return new Response("Origin not allowed", { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}

export function enforceOrigin(request: Request): Response | null {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (!originAllowed(origin, host)) {
    return new Response("Origin not allowed", {
      status: 403,
      headers: corsHeadersFor(request),
    });
  }
  return null;
}

// ---- Body size cap --------------------------------------------------------
export function enforceMaxBody(request: Request, maxBytes: number): Response | null {
  const len = request.headers.get("content-length");
  if (len && Number(len) > maxBytes) {
    return new Response("Payload too large", {
      status: 413,
      headers: corsHeadersFor(request),
    });
  }
  return null;
}

// ---- Rate limiting (in-memory, per worker isolate) ------------------------
// Best-effort: edge runtimes spin up multiple isolates so this is not a hard
// global cap, but it stops a single isolate from being hammered by one IP.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function rateLimit(
  request: Request,
  opts: { key: string; limit: number; windowMs: number },
): Response | null {
  const ip = clientIp(request);
  const bucketKey = `${opts.key}:${ip}`;
  const now = Date.now();
  let b = buckets.get(bucketKey);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(bucketKey, b);
  }
  b.count++;
  if (b.count > opts.limit) {
    const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return new Response("Too many requests", {
      status: 429,
      headers: {
        ...corsHeadersFor(request),
        "Retry-After": String(retry),
      },
    });
  }
  // Opportunistic cleanup so the map doesn't grow forever.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  return null;
}

// ---- Strong password ------------------------------------------------------
// Top common passwords — short curated list to block the obvious ones.
// Anything longer than a quick check belongs in a HIBP integration.
const COMMON_PASSWORDS = new Set<string>([
  "password", "password1", "password12", "password123", "password1234",
  "passw0rd", "p@ssword", "p@ssw0rd", "p@ssw0rd!", "p@ssword1",
  "qwerty123!", "qwerty12345", "qwertyuiop1!",
  "111111111111", "123456789012", "1234567890!@", "1q2w3e4r5t6y",
  "letmein1234!", "welcome12345", "welcome1234!", "iloveyou1234",
  "admin1234567", "admin1234!@#", "administrator1",
  "monkey1234567", "dragon1234!@", "sunshine1234",
  "trustno1234!", "abc123!@#456", "0123456789!@",
]);

export const strongPasswordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((p) => /[0-9]/.test(p), "Password must contain a number")
  .refine(
    (p) => /[^A-Za-z0-9]/.test(p),
    "Password must contain a special character",
  )
  .refine(
    (p) => !COMMON_PASSWORDS.has(p.toLowerCase()),
    "This password is too common — pick something less guessable",
  );

// Turns a server-side denial into a thrown error instead of query data.
//
// Gated server functions answer a denied caller with a 403 whose body is
// { error: "forbidden", capability, upgradeRequired }. TanStack Query has no way
// to know that body is not the payload, so `data` becomes the denial object and
// the page crashes on the first `.map` / `.length`. Wrapping the queryFn makes
// the denial an error, which is what the UI already handles, and leaves the lock
// screen or preview state free to render.

export class CapabilityError extends Error {
  readonly capability?: string;
  readonly status: 401 | 403;
  constructor(status: 401 | 403, capability?: string) {
    super(status === 401 ? "Sign in to continue" : "This is part of a paid plan");
    this.name = "CapabilityError";
    this.status = status;
    this.capability = capability;
  }
}

type DenialBody = { error?: unknown; capability?: unknown };

/** True when a resolved value is really a denial body, not a payload. */
export function isDenial(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const err = (value as DenialBody).error;
  return err === "forbidden" || err === "unauthorized";
}

/** Wraps a queryFn result: denial bodies are rethrown as CapabilityError. */
export async function guarded<T>(promise: Promise<T>): Promise<T> {
  const value = await promise;
  if (isDenial(value)) {
    const body = value as DenialBody;
    const capability = typeof body.capability === "string" ? body.capability : undefined;
    throw new CapabilityError(body.error === "unauthorized" ? 401 : 403, capability);
  }
  return value;
}

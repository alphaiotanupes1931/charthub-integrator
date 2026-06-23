export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[error-report]", error, context);
  }
}

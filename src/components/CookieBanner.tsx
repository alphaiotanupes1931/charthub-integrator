import { useEffect, useState } from "react";

const KEY = "trademind.cookie-notice.ack.v1";

/**
 * Lightweight cookie notice. We only use strictly necessary storage (auth session,
 * UI prefs, local journal). No tracking, no consent toggles needed - just disclosure.
 */
export function CookieBanner() {
  const [ack, setAck] = useState(true);

  useEffect(() => {
    try {
      setAck(window.localStorage.getItem(KEY) === "1");
    } catch {
      setAck(true);
    }
  }, []);

  if (ack) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setAck(true);
  }

  return (
    <div className="fixed inset-x-3 bottom-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-[60]">
      <div className="rounded-xl border border-border bg-card/95 backdrop-blur p-4 sm:p-5 shadow-2xl">
        <p className="text-xs sm:text-sm text-foreground">
          We use only strictly necessary cookies and local storage to keep you signed in and remember your
          preferences. No advertising, no cross-site tracking.{" "}
          <a href="/cookies" className="text-primary underline">Learn more</a>.
        </p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

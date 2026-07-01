import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Polls /api/version and hard-reloads when the deployed version changes,
// so users on old cached JS bundles pick up new code automatically.
export function VersionWatcher() {
  const initial = useRef<string | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string };
        if (!version || cancelled) return;
        if (initial.current === null) {
          initial.current = version;
          return;
        }
        if (version !== initial.current && !notified.current) {
          notified.current = true;
          toast("A new version is available. Refreshing...", { duration: 2500 });
          window.setTimeout(() => {
            try {
              if ("caches" in window) {
                caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
              }
            } catch { /* ignore */ }
            window.location.reload();
          }, 1200);
        }
      } catch { /* ignore */ }
    }

    // First poll shortly after mount, then every 60s. Also poll when the tab
    // regains focus so returning users get fresh code immediately.
    const scheduled = window.setTimeout(check, 3000);
    timer = window.setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearTimeout(scheduled);
      if (timer) window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return null;
}

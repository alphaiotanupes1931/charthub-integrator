import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

type Status = { claude: "ok" | "out_of_credits" | "not_configured"; fallbackActive: boolean };

/**
 * Slim, quiet notice shown only when the Claude account is out of credits.
 * Replies still work on the backup model, so the copy says exactly that
 * instead of implying the coach is down.
 */
export function AiCreditNotice({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/chat", { method: "GET" });
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (alive) setStatus(data);
      } catch {
        /* offline: stay silent rather than showing a false alarm */
      }
    };
    void check();
    const id = setInterval(check, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (dismissed || !status || status.claude !== "out_of_credits") return null;

  return (
    <div
      className={`flex items-start gap-2.5 border-b border-border bg-muted/40 px-3 py-2 ${className}`}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Claude has run out of credits.</span>{" "}
        Your coach is answering on the backup model for now. Please contact admin to top up.
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Dismiss
      </button>
    </div>
  );
}

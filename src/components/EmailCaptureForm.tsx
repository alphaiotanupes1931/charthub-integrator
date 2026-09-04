import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check } from "lucide-react";
import { captureLead } from "@/lib/leads.functions";
import { track } from "@/lib/product-events";

type Props = {
  /** Which surface the address came from, stored with the lead. */
  source: string;
  className?: string;
  cta?: string;
  note?: string;
};

/**
 * Top of the free-plan funnel: take the email first, then hand the visitor to
 * signup. Nothing is gated behind this — it only starts the welcome sequence.
 */
export function EmailCaptureForm({ source, className = "", cta = "Get free access", note }: Props) {
  const submit = useServerFn(captureLead);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    const value = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setState("error");
      return;
    }
    setState("sending");
    try {
      const ref = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") : null;
      await submit({ data: { email: value, source, ref } });
      track("lead_captured", { source });
      setState("done");
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div
        data-testid="email-capture-done"
        className={`rounded-2xl border border-border/60 bg-card/60 backdrop-blur-md p-4 text-sm ${className}`}
      >
        <p className="flex items-center justify-center gap-2 font-medium">
          <Check className="size-4 text-primary" />
          Check your inbox, then create your free account.
        </p>
        <a
          href={`/auth?mode=signup&email=${encodeURIComponent(email.trim())}`}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          Create free account
          <ArrowRight className="size-4" />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className} data-testid="email-capture">
      <div className="flex flex-col sm:flex-row items-stretch gap-2 max-w-md mx-auto">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          placeholder="you@email.com"
          aria-label="Email address"
          className="flex-1 rounded-full border border-border/60 bg-card/70 backdrop-blur-md px-5 py-3 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {state === "sending" ? "Sending" : cta}
          <ArrowRight className="size-4" />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {state === "error"
          ? "That email did not go through. Check the address and try again."
          : note || "2 signal grades a day, no card. Unsubscribe any time."}
      </p>
    </form>
  );
}

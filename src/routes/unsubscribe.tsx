// Branded opt-out page. Marketing emails link here so the confirmation lives
// on trademindaicoach.com instead of a generic hosted page.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MailX, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribe, lookupUnsubscribe } from "@/lib/unsubscribe.functions";
import logoAsset from "@/assets/logo.png.asset.json";

type View = "loading" | "ready" | "already" | "done" | "invalid";

export const Route = createFileRoute("/unsubscribe")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Email preferences, TradeMind" },
      {
        name: "description",
        content: "Confirm that you want to stop receiving TradeMind marketing emails. Account and security emails still come through.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Email preferences, TradeMind" },
      { property: "og:description", content: "Manage the TradeMind emails you receive." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const [view, setView] = useState<View>("loading");
  const [masked, setMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (!t) {
      setView("invalid");
      return;
    }
    setToken(t);
    lookupUnsubscribe({ data: { token: t } })
      .then((r) => {
        setMasked(r.masked);
        setView(r.status === "ready" ? "ready" : r.status === "already" ? "already" : "invalid");
      })
      .catch(() => setView("invalid"));
  }, []);

  async function onConfirm() {
    if (!token) return;
    setBusy(true);
    try {
      const r = await confirmUnsubscribe({ data: { token } });
      setMasked(r.masked);
      setView(r.status === "done" ? "done" : "invalid");
    } catch {
      setView("invalid");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <img src={logoAsset.url} alt="TradeMind" className="mx-auto h-9 w-auto" />

        <div className="mt-7 flex justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-foreground">
            {view === "done" || view === "already" ? <Check className="h-6 w-6" /> : <MailX className="h-6 w-6" />}
          </span>
        </div>

        {view === "loading" && (
          <p className="mt-6 text-sm text-muted-foreground">Checking your link...</p>
        )}

        {view === "ready" && (
          <>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">Confirm unsubscribe</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {masked} will stop receiving TradeMind marketing emails. Account, billing and security
              emails still come through.
            </p>
            <Button className="mt-7 w-full rounded-full" onClick={onConfirm} disabled={busy}>
              {busy ? "Unsubscribing..." : "Unsubscribe"}
            </Button>
          </>
        )}

        {view === "done" && (
          <>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">You're unsubscribed</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {masked} has been removed from TradeMind marketing emails. Account, billing and
              security emails still come through.
            </p>
          </>
        )}

        {view === "already" && (
          <>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">Already unsubscribed</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {masked} is already off the TradeMind marketing list.
            </p>
          </>
        )}

        {view === "invalid" && (
          <>
            <h1 className="mt-6 text-2xl font-semibold text-foreground">Link no longer valid</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              This unsubscribe link is missing or expired. Open the newest TradeMind email and use
              the link at the bottom of it.
            </p>
          </>
        )}

        <div className="mt-8 border-t border-border pt-5">
          <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            trademindaicoach.com
          </Link>
        </div>
      </div>
    </main>
  );
}

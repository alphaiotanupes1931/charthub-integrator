import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { completeAlpacaLogin } from "@/lib/broker-alpaca.functions";

export const Route = createFileRoute("/broker/alpaca/callback")({
  component: AlpacaCallback,
  head: () => ({
    meta: [
      { title: "Finishing Alpaca sign-in | TradeMind" },
      {
        name: "description",
        content: "Completing your secure Alpaca broker sign-in and linking the account to TradeMind.",
      },
      { property: "og:title", content: "Finishing Alpaca sign-in | TradeMind" },
      {
        property: "og:description",
        content: "Completing your secure Alpaca broker sign-in and linking the account to TradeMind.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AlpacaCallback() {
  const navigate = useNavigate();
  const complete = useServerFn(completeAlpacaLogin);
  const ran = useRef(false);
  const [message, setMessage] = useState("Finishing your Alpaca sign-in...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error_description") ?? params.get("error");

    if (error || !code || !state) {
      setFailed(true);
      setMessage(error ?? "Alpaca did not return a login code. Try connecting again.");
      return;
    }

    void complete({ data: { code, state, origin: window.location.origin } })
      .then((res) => {
        setMessage(
          `Connected to your Alpaca ${res.env === "live" ? "live" : "paper"} account. Taking you back...`,
        );
        setTimeout(() => void navigate({ to: "/broker", search: { alpaca: "connected" } as never }), 900);
      })
      .catch((e: Error) => {
        setFailed(true);
        setMessage(e.message);
      });
  }, [complete, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-md border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold mb-2">Alpaca sign-in</h1>
        <p className={`text-sm ${failed ? "text-red-500" : "text-muted-foreground"}`}>{message}</p>
        {failed && (
          <button
            onClick={() => void navigate({ to: "/broker" })}
            className="mt-4 inline-flex items-center px-3 py-2 rounded-md border border-border text-sm hover:bg-muted"
          >
            Back to brokers
          </button>
        )}
      </div>
    </main>
  );
}

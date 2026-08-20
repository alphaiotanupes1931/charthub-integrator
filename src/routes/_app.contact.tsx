import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy, MessageSquare, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { useProfile } from "@/hooks/useProfile";
import { submitSupportRequest, listMySupportRequests } from "@/lib/support.functions";

export const Route = createFileRoute("/_app/contact")({
  head: () => ({
    meta: [
      { title: "Contact and Support, TradeMind" },
      { name: "description", content: "Open a support ticket or send feedback to the TradeMind team." },
      { property: "og:title", content: "Contact and Support, TradeMind" },
      { property: "og:description", content: "Open a support ticket or send feedback to the TradeMind team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContactPage,
});

type Kind = "ticket" | "feedback";

function ContactPage() {
  const qc = useQueryClient();
  const { profile } = useProfile();
  const submitFn = useServerFn(submitSupportRequest);
  const listFn = useServerFn(listMySupportRequests);

  const [kind, setKind] = useState<Kind>("ticket");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [sentiment, setSentiment] = useState<"good" | "neutral" | "bad">("good");

  const email = replyEmail || profile?.email || "";

  const { data: history } = useQuery({
    queryKey: ["support-requests"],
    queryFn: () => listFn(),
  });

  const submit = useMutation({
    mutationFn: () =>
      submitFn({ data: { kind, subject: subject.trim(), message: message.trim(), replyEmail: email.trim(), ...(kind === "feedback" ? { sentiment } : {}) } }),
    onSuccess: () => {
      toast.success(kind === "ticket" ? "Ticket submitted. We will reply by email." : "Feedback sent. Thank you.");
      setSubject("");
      setMessage("");
      void qc.invalidateQueries({ queryKey: ["support-requests"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not submit. Please try again."),
  });

  const valid = subject.trim().length >= 3 && message.trim().length >= 10 && /\S+@\S+\.\S+/.test(email.trim());

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <PageHeader title="Contact and support" description="Report an issue or send feedback straight to the team." />

      <div className="rounded-2xl border border-border/60 p-5">
        <div className="flex gap-2">
          {([
            { id: "ticket" as Kind, label: "Support ticket", icon: LifeBuoy, hint: "Something is broken or blocked" },
            { id: "feedback" as Kind, label: "Feedback", icon: MessageSquare, hint: "An idea or a comment" },
          ]).map((opt) => {
            const active = kind === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKind(opt.id)}
                className={`flex-1 rounded-2xl border px-4 py-3 text-left transition ${
                  active ? "border-foreground/40 bg-muted" : "border-border/60 hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" /> {opt.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{opt.hint}</div>
              </button>
            );
          })}
        </div>

        {kind === "feedback" && (
          <div className="mt-5">
            <span className="text-xs text-muted-foreground">How would you rate this?</span>
            <div className="mt-2 flex gap-2">
              {([
                { id: "good" as const, label: "Good", cls: "border-bull/40 bg-bull/10 text-bull" },
                { id: "neutral" as const, label: "Okay", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
                { id: "bad" as const, label: "Bad", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSentiment(opt.id)}
                  className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-medium transition ${
                    sentiment === opt.id ? opt.cls : "border-border/60 text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">Reply email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setReplyEmail(e.target.value)}
              placeholder="you@example.com"
              maxLength={255}
              className="mt-1 w-full rounded-2xl border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={kind === "ticket" ? "Scan is not returning a grade" : "Idea for the journal"}
              maxLength={140}
              className="mt-1 w-full rounded-2xl border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground">Details</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={4000}
              placeholder="What happened, what you expected, and which page you were on."
              className="mt-1 w-full resize-y rounded-2xl border border-border/60 bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
            />
            <span className="mt-1 block text-right text-[11px] text-muted-foreground">{message.length}/4000</span>
          </label>

          <button
            type="button"
            disabled={!valid || submit.isPending}
            onClick={() => submit.mutate()}
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50"
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {kind === "ticket" ? "Submit ticket" : "Send feedback"}
          </button>
        </div>
      </div>

      {(history?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">Your submissions</h2>
          <div className="divide-y divide-border rounded-2xl border border-border/60">
            {history!.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{row.subject}</div>
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                    {row.status.replace("_", " ")}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.kind === "ticket" ? "Support ticket" : "Feedback"} · {new Date(row.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LogoLink } from "@/components/LogoLink";
import { TraderProfileFlow } from "@/components/trader-profile/TraderProfileFlow";
import { recommend } from "@/lib/trader-profile/score";
import { TRADER_TYPES, type Answers } from "@/lib/trader-profile/config";
import { saveQuizDraft, submitQuizLead } from "@/lib/trader-profile.functions";
import { trackPublicEvent } from "@/lib/product-events.functions";
import { writeDraft, readAttribution } from "@/lib/trader-profile/draft";
import { SHARE_IMAGES, SLUG_FOR, SITE_ORIGIN } from "@/lib/trader-profile/share";

const TITLE = "What's your trader type? — TradeMind";
const DESC = "Sixty seconds, one tap per question. Find out what kind of trader you are and what's really costing you money.";

export const Route = createFileRoute("/quiz/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: "What's your trader type?" },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QuizPage,
});

function QuizPage() {
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(saveQuizDraft);
  const lead = useServerFn(submitQuizLead);
  const ev = useServerFn(trackPublicEvent);
  const fire = (event: "profile_started" | "profile_question_answered" | "profile_completed" | "profile_shared", props: Record<string, string | number>) =>
    { ev({ data: { event, props } }).catch(() => {}); };

  const rec = answers ? recommend(answers) : null;

  async function finish(a: Answers) {
    setAnswers(a);
    const r = recommend(a);
    fire("profile_completed", { trader_type: r.type, where: "public" });
    const attr = readAttribution();
    writeDraft({ answers: a, source: "public_quiz", ref: attr.ref, utm: attr.utm });
    try {
      const { code } = await save({ data: { answers: a as Record<string, string>, ref: attr.ref, utm: attr.utm } });
      writeDraft({ answers: a, source: "public_quiz", code, ref: attr.ref, utm: attr.utm });
    } catch { /* local copy still carries over on this device */ }
  }

  async function sendEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!answers || busy) return;
    setBusy(true);
    try {
      const attr = readAttribution();
      await lead({ data: { email, answers: answers as Record<string, string>, ref: attr.ref, utm: attr.utm } });
      setSentEmail(true);
      toast.success("Sent. Check your inbox.");
    } catch {
      toast.error("Couldn't save that email. Check it and try again.");
    } finally { setBusy(false); }
  }

  async function share() {
    if (!rec) return;
    const t = TRADER_TYPES[rec.type];
    const url = `${SITE_ORIGIN}/quiz/${SLUG_FOR[rec.type]}`;
    const text = `I'm ${t.name}. What's your trader type?`;
    fire("profile_shared", { trader_type: rec.type });
    try {
      const blob = await (await fetch(SHARE_IMAGES[rec.type].story)).blob();
      const file = new File([blob], `${SLUG_FOR[rec.type]}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, url }); return; }
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch { /* fall back to copy */ }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast.success("Link copied"); } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="w-full max-w-md mx-auto">
        <LogoLink to="/" size="lg" variant="brand" textClassName="text-xl" className="justify-center mb-8" />
        <div className="rounded-2xl border border-border/60 bg-card p-6">
          {!rec ? (
            <TraderProfileFlow
              mode="public"
              onStart={(path) => fire("profile_started", { path, where: "public" })}
              onAnswer={(key) => fire("profile_question_answered", { question: key, where: "public" })}
              onComplete={(a) => { void finish(a); }}
            />
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">You're</div>
              <h1 className="text-3xl font-semibold tracking-tight -mt-3">{TRADER_TYPES[rec.type].name}</h1>
              <p className="text-sm text-primary">{TRADER_TYPES[rec.type].short}</p>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{TRADER_TYPES[rec.type].read}</p>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm">
                Your full breakdown is ready: your coach, starter strategy, risk rails and a 5-day plan, already set up.
              </div>
              <Button asChild className="w-full h-11">
                <Link to="/auth" search={{ mode: "signup" } as never}>Unlock my full setup, free</Link>
              </Button>
              <Button variant="outline" className="w-full" onClick={share}>Share my trader type</Button>
              {!sentEmail ? (
                <form onSubmit={sendEmail} className="space-y-2 pt-2 border-t border-border/60">
                  <label htmlFor="quiz-email" className="text-xs text-muted-foreground">Not ready? Get your result by email.</label>
                  <div className="flex gap-2">
                    <input id="quiz-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
                      className="flex-1 h-10 rounded-xl border border-border/60 bg-background px-3 text-sm focus:outline-none focus:border-primary/50" />
                    <Button type="submit" variant="outline" disabled={busy}>Send</Button>
                  </div>
                </form>
              ) : <p className="text-xs text-muted-foreground">Result sent. You can still unlock your setup any time.</p>}
              <p className="text-[11px] text-muted-foreground">Educational, not financial advice.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


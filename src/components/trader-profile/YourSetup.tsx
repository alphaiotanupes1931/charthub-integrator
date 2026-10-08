import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COACHES, TRADER_TYPES, TONE_LABEL, RISK_CAUTIOUS, RISK_STANDARD, type Answers, type CoachName, type RiskDefaults } from "@/lib/trader-profile/config";
import { recommend } from "@/lib/trader-profile/score";
import { STRATEGIES } from "@/data/strategies";
import { applyTraderSetup } from "@/lib/trader-profile.functions";
import { writeActiveCoach, writeActiveStrategy } from "@/lib/chat-client";
import { clearDraft, clearAttributionCode, readAttribution, writeWeek } from "@/lib/trader-profile/draft";
import { track } from "@/lib/product-events";

type Props = {
  answers: Answers;
  source: "public_quiz" | "onboarding" | "self_select";
  draftCode?: string | null;
  onDone: () => void;
  onRetake?: () => void;
};

export function YourSetup({ answers, source, draftCode, onDone, onRetake }: Props) {
  const rec = useMemo(() => recommend(answers), [answers]);
  const t = TRADER_TYPES[rec.type];
  const [coach, setCoach] = useState<CoachName>(rec.coach);
  const [strategies, setStrategies] = useState<string[]>(rec.strategies);
  const [risk, setRisk] = useState<RiskDefaults>(rec.risk);
  const [editing, setEditing] = useState<null | "coach" | "strategy" | "risk">(null);
  const [busy, setBusy] = useState(false);
  const apply = useServerFn(applyTraderSetup);
  const strategyNames = STRATEGIES.map((s) => s.name);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const attr = readAttribution();
      const res = await apply({ data: { source, answers: answers as Record<string, string>, coach, strategies, risk,
        ref: attr.ref, utm: attr.utm, draftCode: draftCode ?? null } });
      writeActiveCoach(coach);
      writeActiveStrategy(strategies[0] ?? null);
      writeWeek({ type: rec.type, startedAt: new Date().toISOString(), tasks: rec.week, done: {} });
      clearDraft();
      clearAttributionCode();
      track(res.accepted ? "setup_accepted" : "setup_changed", { trader_type: rec.type, source });
      if (source === "public_quiz") track("signup_from_profile", { trader_type: rec.type, ref: attr.ref });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your setup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-muted-foreground">Your trader type</div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t.read}</p>
      </div>

      <Card title="Your coach" onChange={() => setEditing(editing === "coach" ? null : "coach")}>
        <div className="font-semibold">{coach}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {coach === rec.coach ? rec.coachReason : "Your pick."} Tone: {TONE_LABEL[rec.tone]}.
        </div>
        {editing === "coach" && (
          <div className="mt-3 grid grid-cols-1 gap-1.5">
            {COACHES.map((c) => <Chip key={c} active={c === coach} onClick={() => { setCoach(c); setEditing(null); }}>{c}</Chip>)}
          </div>
        )}
      </Card>

      <Card title="Your strategy" onChange={() => setEditing(editing === "strategy" ? null : "strategy")}>
        <div className="font-semibold">{strategies.join(" + ")}</div>
        <div className="text-xs text-muted-foreground mt-0.5">Starter playbooks from the Strategy Library that fit how you trade.</div>
        {editing === "strategy" && (
          <div className="mt-3 grid grid-cols-1 gap-1.5">
            {strategyNames.map((n) => {
              const on = strategies.includes(n);
              return (
                <Chip key={n} active={on} onClick={() => {
                  if (on) { if (strategies.length > 1) setStrategies(strategies.filter((s) => s !== n)); }
                  else setStrategies([...strategies, n].slice(-2));
                }}>{n}</Chip>
              );
            })}
            <div className="text-[11px] text-muted-foreground">Pick up to two.</div>
          </div>
        )}
      </Card>

      <Card title="Your risk rails" onChange={() => setEditing(editing === "risk" ? null : "risk")}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Risk per trade" value={`${risk.riskPct}%`} />
          <Stat label="Max daily loss" value={`${risk.maxDailyLossPct}%`} />
          <Stat label="Minimum grade" value={risk.minGrade} />
        </div>
        {editing === "risk" && (
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <Chip active={risk.riskPct === RISK_CAUTIOUS.riskPct} onClick={() => { setRisk({ ...RISK_CAUTIOUS }); setEditing(null); }}>Cautious: 0.5% / 2% / A</Chip>
            <Chip active={risk.riskPct === RISK_STANDARD.riskPct} onClick={() => { setRisk({ ...RISK_STANDARD }); setEditing(null); }}>Standard: 1% / 3% / B+</Chip>
          </div>
        )}
      </Card>

      <Card title="Your first week">
        <ol className="space-y-1.5">
          {rec.week.map((w) => (
            <li key={w.day} className="flex gap-3 text-sm">
              <span className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5">Day {w.day}</span>
              <span>{w.label}</span>
            </li>
          ))}
        </ol>
      </Card>

      <p className="text-[11px] text-muted-foreground">Recommendations are educational, not financial advice. You can change any of this later in Settings.</p>

      <Button className="w-full h-11" onClick={start} disabled={busy}>{busy ? "Setting up..." : "Start my first week"}</Button>
      {onRetake && <button onClick={onRetake} className="w-full text-xs text-muted-foreground hover:text-foreground underline">Retake the questions</button>}
    </div>
  );
}

function Card({ title, onChange, children }: { title: string; onChange?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        {onChange && <button onClick={onChange} className="text-xs text-primary hover:underline">Change</button>}
      </div>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/40 py-2"><div className="font-semibold">{value}</div><div className="text-[10px] text-muted-foreground">{label}</div></div>;
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left text-xs font-medium ${active ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:border-primary/40"}`}>
      {children}
    </button>
  );
}

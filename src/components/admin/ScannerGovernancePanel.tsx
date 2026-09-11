import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BookOpen, CheckCircle2, ClipboardCheck, Kanban, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  adminSaveCommandBoardItem,
  adminSaveScannerReview,
  adminScannerGovernance,
} from "@/lib/admin.functions";

type Governance = Awaited<ReturnType<typeof adminScannerGovernance>>;
type Decision = "approved" | "rejected" | "needs_changes";
type BoardStatus = "planned" | "building" | "testing" | "approved" | "blocked";

const METHOD_SECTIONS = [
  ["Inputs and data", "Closed market candles, current price, ATR, volume, structure, order flow, economic calendar, instrument profile, strategy, and trade style."],
  ["Timeframe roles", "Daily and 4H set direction and context. 1H supplies structure and the preferred order block. Scalp confirms on 5m, intraday on 15m, and swing on 1H."],
  ["Order-block evidence", "A block must be a real opposing candle before displacement. Freshness, displacement, 4H alignment, liquidity sweep, mitigation count, and distance determine its quality."],
  ["Grades and waits", "A/A+ requires a high-quality aligned 1H block and all safety gates. Conflicts, stale data, opposing flow, session timing, and news cap or reduce grades. Unconfirmed setups wait instead of entering."],
  ["Stops and targets", "Stops sit beyond the invalidating zone and swing with an ATR buffer. Targets use the nearest opposing structure on the selected execution horizon; R:R reports the result but does not invent the target."],
  ["Timing and outcomes", "The selected trade style controls confirmation, expected hold time, and reachable target distance. Filed scans resolve against real bars and remain separate from expert review opinions."],
] as const;

function jsonObject(text: string, label: string): Record<string, unknown> {
  if (!text.trim()) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

export function ScannerGovernancePanel() {
  const load = useServerFn(adminScannerGovernance);
  const saveReview = useServerFn(adminSaveScannerReview);
  const saveBoard = useServerFn(adminSaveCommandBoardItem);
  const [data, setData] = useState<Governance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState({ symbol: "", timeframe: "60", decision: "needs_changes" as Decision, original: "{}", corrected: "{}", replay: "{}", note: "", fixture: false });
  const [item, setItem] = useState({ phase: "Phase 5", owner: "Marcus", title: "", status: "planned" as BoardStatus, notes: "" });

  const refresh = async () => {
    try { setData(await load()); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not load scanner governance"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const active = data?.methodology.find((m) => m.status === "active") ?? data?.methodology[0];

  const submitReview = async () => {
    if (!review.symbol.trim()) return toast.error("Add an instrument");
    setSaving(true);
    try {
      await saveReview({ data: {
        methodologyVersion: active?.version ?? "2026.09-v1",
        symbol: review.symbol,
        timeframe: review.timeframe,
        decision: review.decision,
        originalDecision: jsonObject(review.original, "Original decision"),
        correctedLevels: jsonObject(review.corrected, "Corrected levels"),
        replayCase: jsonObject(review.replay, "Replay case"),
        note: review.note,
        promotedToFixture: review.fixture,
      } });
      setReview((r) => ({ ...r, symbol: "", original: "{}", corrected: "{}", replay: "{}", note: "", fixture: false }));
      await refresh();
      toast.success("Expert review saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save review"); }
    finally { setSaving(false); }
  };

  const submitBoard = async () => {
    if (!item.title.trim()) return toast.error("Add an action title");
    setSaving(true);
    try {
      await saveBoard({ data: { ...item, sortOrder: data?.board.length ?? 0 } });
      setItem((v) => ({ ...v, title: "", notes: "" }));
      await refresh();
      toast.success("Command board updated");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save action"); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading scanner governance</div>;

  return <div className="space-y-6" data-testid="scanner-governance">
    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-primary" /> How the scanner works</h2><p className="mt-1 text-xs text-muted-foreground">The production rules in plain language, not an AI prompt.</p></div>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{active?.version ?? "No active version"}</span>
      </div>
      {active && <p className="text-sm text-foreground/90">{active.summary}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {METHOD_SECTIONS.map(([title, body]) => <div key={title} className="rounded-xl border border-border/60 bg-background/40 p-4"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p></div>)}
      </div>
      <div className="text-xs text-muted-foreground">Saved scans carry this version, so results remain reproducible after rules change.</div>
    </section>

    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div><h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Expert review</h2><p className="mt-1 text-xs text-muted-foreground">Review decisions never alter live rules automatically. Promote approved cases into regression fixtures.</p></div>
      <div className="grid gap-3 md:grid-cols-3"><Input aria-label="Review instrument" placeholder="Instrument, e.g. USD/JPY" value={review.symbol} onChange={(e) => setReview({ ...review, symbol: e.target.value })}/><Input aria-label="Review timeframe" placeholder="Timeframe" value={review.timeframe} onChange={(e) => setReview({ ...review, timeframe: e.target.value })}/><select aria-label="Review decision" className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm" value={review.decision} onChange={(e) => setReview({ ...review, decision: e.target.value as Decision })}><option value="approved">Approve</option><option value="rejected">Reject</option><option value="needs_changes">Needs changes</option></select></div>
      <div className="grid gap-3 md:grid-cols-3"><Textarea aria-label="Original engine decision" placeholder='Original decision JSON: {"entry": 1.2}' value={review.original} onChange={(e) => setReview({ ...review, original: e.target.value })}/><Textarea aria-label="Corrected levels" placeholder='Corrected levels JSON: {"entry": 1.21}' value={review.corrected} onChange={(e) => setReview({ ...review, corrected: e.target.value })}/><Textarea aria-label="Replay case" placeholder='Replay/candle reference JSON' value={review.replay} onChange={(e) => setReview({ ...review, replay: e.target.value })}/></div>
      <Textarea aria-label="Expert review note" placeholder="Why the original block, entry, stop, or target was right or wrong" value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })}/>
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={review.fixture} onChange={(e) => setReview({ ...review, fixture: e.target.checked })}/> Promote this reviewed case to a regression fixture</label><Button onClick={submitReview} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Save review</Button></div>
      <div className="divide-y divide-border/60 rounded-xl border border-border/60">{(data?.reviews ?? []).length === 0 ? <div className="p-4 text-sm text-muted-foreground">No reviews yet.</div> : data?.reviews.map((r) => <div key={r.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.symbol} · {r.timeframe}</span><span className="text-xs uppercase text-muted-foreground">{r.decision.replace("_", " ")}{r.promoted_to_fixture ? " · fixture" : ""}</span></div><p className="mt-1 text-xs text-muted-foreground">{r.methodology_version} · {new Date(r.created_at).toLocaleString()}</p>{r.note && <p className="mt-2 text-sm">{r.note}</p>}</div>)}</div>
    </section>

    <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
      <div><h2 className="flex items-center gap-2 font-semibold"><Kanban className="h-4 w-4 text-primary" /> Command board</h2><p className="mt-1 text-xs text-muted-foreground">Meeting actions, owner, phase, and release status.</p></div>
      <div className="grid gap-3 md:grid-cols-4"><Input placeholder="Phase" value={item.phase} onChange={(e) => setItem({ ...item, phase: e.target.value })}/><Input placeholder="Owner" value={item.owner} onChange={(e) => setItem({ ...item, owner: e.target.value })}/><Input className="md:col-span-2" placeholder="Action title" value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })}/></div>
      <div className="flex gap-3"><select aria-label="Command status" className="h-10 flex-1 rounded-xl border border-border/60 bg-background px-3 text-sm" value={item.status} onChange={(e) => setItem({ ...item, status: e.target.value as BoardStatus })}>{["planned","building","testing","approved","blocked"].map((s) => <option key={s} value={s}>{s}</option>)}</select><Button onClick={submitBoard} disabled={saving}><Plus /> Add action</Button></div>
      <Textarea placeholder="Action notes (optional)" value={item.notes} onChange={(e) => setItem({ ...item, notes: e.target.value })}/>
      <div className="grid gap-3 md:grid-cols-2">{(data?.board ?? []).length === 0 ? <div className="text-sm text-muted-foreground">No command-board actions yet.</div> : data?.board.map((b) => <div key={b.id} className="rounded-xl border border-border/60 p-4"><div className="flex items-start justify-between gap-2"><div><div className="font-medium">{b.title}</div><div className="mt-1 text-xs text-muted-foreground">{b.phase} · {b.owner}</div></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold uppercase">{b.status}</span></div>{b.notes && <p className="mt-2 text-xs text-muted-foreground">{b.notes}</p>}</div>)}</div>
    </section>
  </div>;
}
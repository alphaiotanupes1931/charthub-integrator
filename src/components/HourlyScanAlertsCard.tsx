// Settings for the hourly scan alert: which instruments, which scan models,
// which grade is worth a ping, and when to stay quiet.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Radar } from "lucide-react";

import { ANALYSIS_MODELS, type AnalysisModelId } from "@/lib/analysis-models";
import { ALERT_GRADES, type AlertMinGrade } from "@/lib/signal-alerts.shared";
import { getMySignalAlertPrefs, saveMySignalAlertPrefs } from "@/lib/signal-alerts.functions";

const SYMBOLS = [
  "XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY",
  "NAS100", "SPX500", "US30", "BTC/USD", "ETH/USD", "WTI",
];

const GRADE_LABEL: Record<AlertMinGrade, string> = {
  "A+": "A+ only",
  A: "A and better",
  B: "B and better",
};

export function HourlyScanAlertsCard({ enabled: hasSession }: { enabled: boolean }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getMySignalAlertPrefs);
  const saveFn = useServerFn(saveMySignalAlertPrefs);

  const { data } = useQuery({
    queryKey: ["signal-alert-prefs"],
    queryFn: () => getFn(),
    enabled: hasSession,
  });

  const [on, setOn] = useState(false);
  const [minGrade, setMinGrade] = useState<AlertMinGrade>("A");
  const [symbols, setSymbols] = useState<string[]>(["XAU/USD", "EUR/USD", "NAS100"]);
  const [models, setModels] = useState<AnalysisModelId[]>(["classic"]);
  const [quietFrom, setQuietFrom] = useState(22);
  const [quietTo, setQuietTo] = useState(6);

  useEffect(() => {
    const p = data?.prefs;
    if (!p) return;
    setOn(p.enabled);
    setMinGrade((ALERT_GRADES as readonly string[]).includes(p.min_grade) ? (p.min_grade as AlertMinGrade) : "A");
    setSymbols(p.symbols ?? []);
    setModels((p.models ?? ["classic"]) as AnalysisModelId[]);
    setQuietFrom(p.quiet_from);
    setQuietTo(p.quiet_to);
  }, [data]);

  const mSave = useMutation({
    mutationFn: (payload: Parameters<typeof saveFn>[0] extends { data: infer D } ? D : never) =>
      saveFn({ data: payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-alert-prefs"] });
      toast.success("Hourly scan alerts saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const save = () => {
    if (on && symbols.length === 0) {
      toast.error("Pick at least one instrument to watch");
      return;
    }
    mSave.mutate({
      enabled: on,
      min_grade: minGrade,
      symbols,
      models: models.length ? models : (["classic"] as AnalysisModelId[]),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
      quiet_from: quietFrom,
      quiet_to: quietTo,
    });
  };

  const toggleSymbol = (s: string) =>
    setSymbols((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].slice(0, 12)));
  const toggleModel = (id: AnalysisModelId) =>
    setModels((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 md:p-5 mb-8 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><Radar className="h-4 w-4" /></div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Hourly scan alerts</h2>
            <p className="text-xs text-muted-foreground">
              Every hour, once the candle closes, your instruments are scanned and anything that
              meets your grade lands in your notifications. Setups whose entry price has already
              gone are left out.
            </p>
          </div>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          On
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3">
        <div>
          <label className="text-xs tracking-wide text-muted-foreground">Alert me on</label>
          <select
            value={minGrade}
            onChange={(e) => setMinGrade(e.target.value as AlertMinGrade)}
            className="mt-1 w-full h-10 rounded-sm border border-input bg-background px-3 text-sm"
          >
            {ALERT_GRADES.map((g) => <option key={g} value={g}>{GRADE_LABEL[g]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs tracking-wide text-muted-foreground">Quiet from</label>
            <select
              value={quietFrom}
              onChange={(e) => setQuietFrom(Number(e.target.value))}
              className="mt-1 w-full h-10 rounded-sm border border-input bg-background px-3 text-sm"
            >
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs tracking-wide text-muted-foreground">Quiet until</label>
            <select
              value={quietTo}
              onChange={(e) => setQuietTo(Number(e.target.value))}
              className="mt-1 w-full h-10 rounded-sm border border-input bg-background px-3 text-sm"
            >
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </select>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs tracking-wide text-muted-foreground mb-2">Instruments</div>
        <div className="flex flex-wrap gap-2">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleSymbol(s)}
              className={`h-8 rounded-sm border px-3 text-xs ${
                symbols.includes(s)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs tracking-wide text-muted-foreground mb-2">Scan models</div>
        <div className="flex flex-wrap gap-2">
          {ANALYSIS_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleModel(m.id)}
              className={`h-8 rounded-sm border px-3 text-xs ${
                models.includes(m.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={mSave.isPending}
          className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {mSave.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

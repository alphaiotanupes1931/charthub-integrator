import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Calculator, RotateCcw, TrendingUp, DollarSign, Percent, Target } from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/calculator")({
  head: () => ({
    meta: [
      { title: "Risk Calculator, TradeMind" },
      { name: "description", content: "Professional position sizing and risk management for CFDs, indices, futures and forex." },
    ],
  }),
  component: CalculatorPage,
});

type AssetClass = "cfd" | "futures" | "forex";
type Mode = "size" | "rr" | "profit" | "full";

type Instrument = {
  symbol: string;
  name: string;
  /** dollars of P&L per 1 point/pip of price move, per 1 unit (lot/contract) */
  valuePerPoint: number;
  /** smallest price increment shown in inputs */
  tick: number;
  /** unit label shown to user */
  unit: string;
  /** default price hint */
  hint?: string;
};

const INSTRUMENTS: Record<AssetClass, Instrument[]> = {
  cfd: [
    { symbol: "NAS100",  name: "Nasdaq 100",         valuePerPoint: 1,   tick: 0.1,  unit: "lot",      hint: "21500" },
    { symbol: "US30",    name: "Dow Jones",          valuePerPoint: 1,   tick: 1,    unit: "lot",      hint: "43000" },
    { symbol: "SPX500",  name: "S&P 500",            valuePerPoint: 1,   tick: 0.1,  unit: "lot",      hint: "5900" },
    { symbol: "XAUUSD",  name: "Gold",               valuePerPoint: 1,   tick: 0.01, unit: "lot",      hint: "2650" },
    { symbol: "XAGUSD",  name: "Silver",             valuePerPoint: 50,  tick: 0.01, unit: "lot",      hint: "31.20" },
    { symbol: "USOIL",   name: "Crude Oil",          valuePerPoint: 10,  tick: 0.01, unit: "lot",      hint: "72.50" },
    { symbol: "GER40",   name: "DAX",                valuePerPoint: 1,   tick: 0.1,  unit: "lot",      hint: "19800" },
    { symbol: "UK100",   name: "FTSE 100",           valuePerPoint: 1,   tick: 0.5,  unit: "lot",      hint: "8100" },
  ],
  futures: [
    { symbol: "NQ",  name: "E-mini Nasdaq 100",  valuePerPoint: 20,  tick: 0.25, unit: "contract", hint: "21500" },
    { symbol: "MNQ", name: "Micro Nasdaq 100",   valuePerPoint: 2,   tick: 0.25, unit: "contract", hint: "21500" },
    { symbol: "ES",  name: "E-mini S&P 500",     valuePerPoint: 50,  tick: 0.25, unit: "contract", hint: "5900" },
    { symbol: "MES", name: "Micro S&P 500",      valuePerPoint: 5,   tick: 0.25, unit: "contract", hint: "5900" },
    { symbol: "YM",  name: "E-mini Dow",         valuePerPoint: 5,   tick: 1,    unit: "contract", hint: "43000" },
    { symbol: "MYM", name: "Micro Dow",          valuePerPoint: 0.5, tick: 1,    unit: "contract", hint: "43000" },
    { symbol: "GC",  name: "Gold Futures",       valuePerPoint: 100, tick: 0.1,  unit: "contract", hint: "2650" },
    { symbol: "MGC", name: "Micro Gold",         valuePerPoint: 10,  tick: 0.1,  unit: "contract", hint: "2650" },
    { symbol: "CL",  name: "Crude Oil Futures",  valuePerPoint: 1000, tick: 0.01, unit: "contract", hint: "72.50" },
  ],
  forex: [
    { symbol: "EURUSD", name: "Euro / US Dollar",  valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "1.0850" },
    { symbol: "GBPUSD", name: "Pound / US Dollar", valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "1.2650" },
    { symbol: "USDJPY", name: "US Dollar / Yen",   valuePerPoint: 10, tick: 0.01,   unit: "lot", hint: "155.20" },
    { symbol: "AUDUSD", name: "Aussie / US Dollar",valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "0.6550" },
    { symbol: "USDCAD", name: "US Dollar / Loonie",valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "1.4050" },
    { symbol: "NZDUSD", name: "Kiwi / US Dollar",  valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "0.5900" },
    { symbol: "EURGBP", name: "Euro / Pound",      valuePerPoint: 10, tick: 0.0001, unit: "lot", hint: "0.8300" },
  ],
};

const LEVERAGE: { label: string; mult: number }[] = [
  { label: "Standard (1x)", mult: 1 },
  { label: "Aggressive (2x)", mult: 2 },
  { label: "Conservative (0.5x)", mult: 0.5 },
];

const MODES: { key: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "size",   label: "Size",    icon: DollarSign },
  { key: "rr",     label: "R:R",     icon: Target },
  { key: "profit", label: "Profit",  icon: TrendingUp },
  { key: "full",   label: "Full",    icon: Calculator },
];

function CalculatorPage() {
  const [assetClass, setAssetClass] = useState<AssetClass>("cfd");
  const [instrument, setInstrument] = useState<Instrument>(INSTRUMENTS.cfd[0]);
  const [leverage, setLeverage] = useState<number>(1);
  const [mode, setMode] = useState<Mode>("size");

  const [balance, setBalance] = useState<string>("10000");
  const [riskPct, setRiskPct] = useState<string>("2");
  const [entry, setEntry] = useState<string>("");
  const [stop, setStop] = useState<string>("");
  const [tp, setTp] = useState<string>("");

  function reset() {
    setEntry("");
    setStop("");
    setTp("");
  }

  function pickAsset(a: AssetClass) {
    setAssetClass(a);
    setInstrument(INSTRUMENTS[a][0]);
    reset();
  }

  function pickInstrument(sym: string) {
    const inst = INSTRUMENTS[assetClass].find((i) => i.symbol === sym);
    if (inst) { setInstrument(inst); reset(); }
  }

  const result = useMemo(() => {
    const bal = parseFloat(balance) || 0;
    const rPct = parseFloat(riskPct) || 0;
    const dollarRisk = bal * (rPct / 100);
    const e = parseFloat(entry);
    const s = parseFloat(stop);
    const t = parseFloat(tp);

    if (!bal || !rPct) return { dollarRisk: 0, size: 0, stopDist: 0, rr: 0, profit: 0, valid: false };
    if (!isFinite(e) || !isFinite(s) || e === s) {
      return { dollarRisk, size: 0, stopDist: 0, rr: 0, profit: 0, valid: false };
    }

    const stopDist = Math.abs(e - s);
    const valuePerUnit = instrument.valuePerPoint * leverage;
    const rawSize = dollarRisk / (stopDist * valuePerUnit);
    const size = Math.max(0, rawSize);

    let rr = 0;
    let profit = 0;
    if (isFinite(t) && t !== e) {
      const rewardDist = Math.abs(t - e);
      rr = rewardDist / stopDist;
      profit = rewardDist * valuePerUnit * size;
    }

    return { dollarRisk, size, stopDist, rr, profit, valid: true };
  }, [balance, riskPct, entry, stop, tp, instrument, leverage]);

  const [hasEmittedCalc, setHasEmittedCalc] = useState(false);
  useEffect(() => {
    if (result.valid && !hasEmittedCalc) {
      setHasEmittedCalc(true);
      emitFirstWeekEvent("calculator-used");
    }
  }, [result.valid, hasEmittedCalc]);

  const dollarRisk = (parseFloat(balance) || 0) * ((parseFloat(riskPct) || 0) / 100);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Risk Calculator"
        description="Professional position sizing and risk management. Never risk what you cannot afford to lose."
      />

      {/* Asset class tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(["cfd", "futures", "forex"] as AssetClass[]).map((a) => (
          <button
            key={a}
            onClick={() => pickAsset(a)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${
              assetClass === a
                ? "bg-primary/15 text-primary border-primary/40"
                : "bg-card text-muted-foreground border-border/60 hover:border-primary/30 hover:text-foreground"
            }`}
          >
            {a === "cfd" ? "CFD / Indices" : a === "futures" ? "Futures" : "Forex"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-4">
        {/* Left column - inputs */}
        <div className="space-y-4">
          {/* Instrument + leverage */}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] tracking-tight text-muted-foreground font-semibold">Instrument</label>
                <select
                  value={instrument.symbol}
                  onChange={(e) => pickInstrument(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
                >
                  {INSTRUMENTS[assetClass].map((i) => (
                    <option key={i.symbol} value={i.symbol}>{i.symbol} — {i.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] tracking-tight text-muted-foreground font-semibold">Leverage</label>
                <select
                  value={leverage}
                  onChange={(e) => setLeverage(parseFloat(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
                >
                  {LEVERAGE.map((l) => (
                    <option key={l.label} value={l.mult}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {INSTRUMENTS[assetClass].slice(0, 6).map((i) => (
                <button
                  key={i.symbol}
                  onClick={() => pickInstrument(i.symbol)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-medium border transition ${
                    instrument.symbol === i.symbol
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-background text-muted-foreground border-border/60 hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {i.symbol}
                </button>
              ))}
            </div>
          </div>

          {/* Mode tabs */}
          <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-border/60 bg-card p-1.5">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={`inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-medium transition ${
                    mode === m.key
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground -mt-2 px-1">
            {mode === "size" && "Calculate lot / contract size based on your risk."}
            {mode === "rr" && "Calculate reward-to-risk ratio for a planned trade."}
            {mode === "profit" && "Project profit at your target given position size."}
            {mode === "full" && "All calculations in one view: size, R:R and projected profit."}
          </div>

          {/* Account & Risk */}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
            <div className="text-sm font-semibold">Account & Risk</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] tracking-tight text-muted-foreground font-semibold">Account Balance</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <input
                    inputMode="decimal"
                    value={balance}
                    onChange={(e) => setBalance(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full pl-7 pr-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
                    placeholder="10000"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] tracking-tight text-muted-foreground font-semibold flex items-center justify-between">
                  <span>Risk Percentage</span>
                  <span className="text-primary font-bold">{riskPct || "0"}%</span>
                </label>
                <div className="relative mt-1">
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    inputMode="decimal"
                    value={riskPct}
                    onChange={(e) => setRiskPct(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full pl-3 pr-8 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
                    placeholder="2"
                  />
                </div>
                <div className="flex gap-1 mt-1.5">
                  {["1", "2", "3", "5"].map((v) => (
                    <button
                      key={v}
                      onClick={() => setRiskPct(v)}
                      className={`flex-1 px-2 py-1 rounded text-[11px] font-medium border transition ${
                        riskPct === v
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "bg-background text-muted-foreground border-border/60 hover:text-foreground"
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Dollar Risk</span>
              <span className="text-lg font-bold text-primary font-mono">${dollarRisk.toFixed(2)}</span>
            </div>
          </div>

          {/* Entry & Exit */}
          <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Entry & Exit Prices</div>
              <button
                onClick={reset}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PriceField label="Entry Price" value={entry} onChange={setEntry} step={instrument.tick} hint={instrument.hint} />
              <PriceField label="Stop Loss" value={stop} onChange={setStop} step={instrument.tick} tone="stop" />
              <PriceField label="Take Profit" value={tp} onChange={setTp} step={instrument.tick} tone="tp" optional />
            </div>
          </div>
        </div>

        {/* Right column - results */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary font-bold">Results</div>

            {(mode === "size" || mode === "full") && (
              <ResultRow
                label={`Position Size`}
                value={result.valid ? `${result.size.toFixed(2)} ${instrument.unit}${result.size !== 1 ? "s" : ""}` : "—"}
                sub={result.valid && result.stopDist > 0 ? `${result.stopDist.toFixed(instrument.tick < 1 ? 4 : 1)} pts stop` : undefined}
                big
              />
            )}

            {(mode === "rr" || mode === "full") && (
              <ResultRow
                label="Risk / Reward"
                value={result.valid && result.rr > 0 ? `1 : ${result.rr.toFixed(2)}` : "—"}
                tone={result.rr >= 2 ? "good" : result.rr >= 1 ? "ok" : result.rr > 0 ? "bad" : undefined}
              />
            )}

            {(mode === "profit" || mode === "full") && (
              <ResultRow
                label="Projected Profit"
                value={result.valid && result.profit > 0 ? `$${result.profit.toFixed(2)}` : "—"}
                tone="good"
              />
            )}

            <div className="border-t border-border/60 pt-3 space-y-1.5 text-xs">
              <Row label="Dollar Risk" value={`$${dollarRisk.toFixed(2)}`} />
              <Row label="Instrument" value={instrument.symbol} />
              <Row label="$ / point" value={`$${(instrument.valuePerPoint * leverage).toFixed(2)}`} />
              {result.valid && (
                <Row label="Loss if stopped" value={`-$${dollarRisk.toFixed(2)}`} tone="bad" />
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-3 text-[11px] text-muted-foreground leading-relaxed">
            <div className="font-semibold text-foreground mb-1">Rule of thumb</div>
            Risk 1-2% per trade. Ten straight losses at 2% still leaves you with 82% of your account. Ten straight losses at 10% leaves you with 35%.
          </div>
        </div>
      </div>
    </div>
  );
}

function PriceField({
  label,
  value,
  onChange,
  step,
  hint,
  tone,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  hint?: string;
  tone?: "stop" | "tp";
  optional?: boolean;
}) {
  const ring = tone === "stop" ? "focus:border-red-500/50" : tone === "tp" ? "focus:border-bull/50" : "focus:border-primary/50";
  return (
    <div>
      <label className="text-[10px] tracking-tight text-muted-foreground font-semibold flex items-center justify-between">
        <span>{label}</span>
        {optional && <span className="normal-case text-[9px] text-muted-foreground/70">optional</span>}
      </label>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        step={step}
        placeholder={hint}
        className={`mt-1 w-full px-3 py-2 rounded-xl border border-border/60 bg-background text-sm font-mono focus:outline-none ${ring}`}
      />
    </div>
  );
}

function ResultRow({
  label,
  value,
  sub,
  big,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  big?: boolean;
  tone?: "good" | "ok" | "bad";
}) {
  const color =
    tone === "good" ? "text-bull" :
    tone === "bad"  ? "text-red-400" :
    tone === "ok"   ? "text-amber-400" :
    "text-foreground";
  return (
    <div>
      <div className="text-[10px] tracking-tight text-muted-foreground font-semibold">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${tone === "bad" ? "text-red-400" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { compressImageFile } from "@/lib/journalImages";
import { parseClosedTradesScreenshot, type ParsedClosedTrade } from "@/lib/journal-import.functions";

type Props = {
  /** Called with the rows the trader confirmed. Parent writes them to the journal. */
  onImport: (trades: ParsedClosedTrade[], shots: Blob[]) => void;
};

// 4H / 1H / 15m / 5m / 1m is the stack traders paste, so five per read.
const MAX_SHOTS = 5;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function fmt(n: number | null, digits = 4) {
  if (n === null || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 2 : abs >= 10 ? 3 : digits);
}

export function ImportClosedTradesPanel({ onImport }: Props) {
  const parse = useServerFn(parseClosedTradesScreenshot);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [shots, setShots] = useState<{ blob: Blob; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ParsedClosedTrade[] | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const next = [...shots];
    for (const f of list.slice(0, MAX_SHOTS - shots.length)) {
      const blob = await compressImageFile(f, 1800, 0.85);
      next.push({ blob, url: URL.createObjectURL(blob) });
    }
    setShots(next);
    setRows(null);
  };

  const runParse = async () => {
    if (!shots.length || busy) return;
    setBusy(true);
    setRows(null);
    try {
      const images = await Promise.all(shots.map((s) => blobToDataUrl(s.blob)));
      const res = await parse({ data: { images } });
      setNote(res.note);
      setRows(res.trades);
      setSkipped(new Set());
      if (!res.trades.length) toast.error(res.note || "No closed trades found in that screenshot.");
    } catch (e) {
      console.error(e);
      toast.error("Could not read that screenshot. Try a tighter crop of the closed-trades list.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!rows) return;
    const keep = rows.filter((_, i) => !skipped.has(i));
    if (!keep.length) {
      toast.error("Nothing selected to log.");
      return;
    }
    onImport(keep, shots.map((s) => s.blob));
    toast.success(`${keep.length} ${keep.length === 1 ? "trade" : "trades"} added to the journal.`);
    setRows(null);
    setShots([]);
    setNote("");
  };

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-card/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Log closed trades from a screenshot</div>
          <div className="text-[11px] text-muted-foreground">
            Paste, drop or upload up to five screenshots of your broker history or closed positions. The numbers are read out, matched to your open trades and the P&L is logged for you.
          </div>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-xs font-semibold text-foreground hover:bg-accent/60"
        >
          <Upload className="h-3.5 w-3.5" /> Add screenshot
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div
        className="p-3"
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length) void addFiles(files);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
        }}
      >
        {shots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
            Drag a screenshot here, paste one, or use Add screenshot. Up to {MAX_SHOTS} images per import.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shots.map((s, i) => (
              <div key={s.url} className="relative">
                <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-20 w-32 rounded border border-border/60 object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setShots((prev) => prev.filter((_, idx) => idx !== i));
                    setRows(null);
                  }}
                  className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                  aria-label="Remove screenshot"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {shots.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={runParse}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {busy ? "Reading screenshot..." : "Read closed trades"}
            </button>
            <button
              type="button"
              onClick={() => { setShots([]); setRows(null); setNote(""); }}
              className="h-9 rounded-lg border border-border/60 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}

        {note && <div className="mt-2 text-[11px] text-muted-foreground">{note}</div>}

        {rows && rows.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-tight text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Log</th>
                  <th className="px-2 py-1.5">Symbol</th>
                  <th className="px-2 py-1.5">Side</th>
                  <th className="px-2 py-1.5">Entry</th>
                  <th className="px-2 py-1.5">Exit</th>
                  <th className="px-2 py-1.5">Size</th>
                  <th className="px-2 py-1.5">P&amp;L</th>
                  <th className="px-2 py-1.5">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => {
                  const on = !skipped.has(i);
                  const low = (t.confidence ?? 1) < 0.6;
                  return (
                    <tr key={`${t.symbol}-${i}`} className="border-t border-border/50">
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setSkipped((prev) => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i); else next.add(i);
                              return next;
                            })
                          }
                          aria-label={`Log ${t.symbol}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-foreground">
                        {t.symbol}
                        {low && <span className="ml-1 text-[10px] text-amber-500">check</span>}
                      </td>
                      <td className={`px-2 py-1.5 ${t.side === "Long" ? "text-bull" : "text-destructive"}`}>{t.side}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(t.entry)}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(t.exit)}</td>
                      <td className="px-2 py-1.5 font-mono">{fmt(t.size, 2)}</td>
                      <td className={`px-2 py-1.5 font-mono ${(t.pnl ?? 0) >= 0 ? "text-bull" : "text-destructive"}`}>
                        {t.pnl === null ? "-" : t.pnl.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{t.date ?? "today"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-2">
              <span className="text-[11px] text-muted-foreground">
                Rows marked &quot;check&quot; were read with low confidence. Edit them after logging if a number looks wrong.
              </span>
              <button
                type="button"
                onClick={confirm}
                className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
              >
                Log {rows.length - skipped.size} to journal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

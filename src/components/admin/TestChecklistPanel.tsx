// Admin-only QA checklist. Walks the tester through each shipped fix step by
// step, records pass/fail plus a note locally, and links straight to the page
// where the check is performed.
import { useEffect, useMemo, useState } from "react";
import { Check, X, RotateCcw, ExternalLink, ClipboardList } from "lucide-react";

type Result = "pass" | "fail" | null;

type Check = {
  id: string;
  title: string;
  area: string;
  href: string;
  steps: string[];
  expected: string;
};

const CHECKS: Check[] = [
  {
    id: "uploaded-levels",
    title: "Uploaded chart levels win",
    area: "Chat",
    href: "/dashboard",
    steps: [
      "Run a live scan on XAU/USD and note the entry it returns.",
      "Switch to the Chat tab in the same thread.",
      "Upload a chart screenshot with your own entry drawn, or type an entry different from the scan.",
      "Ask the coach to grade your trade.",
    ],
    expected:
      "The reply echoes your entry verbatim and does the R math off it. The earlier scan entry may be mentioned as a comparison only, never re-served as the entry.",
  },
  {
    id: "screenshot-symbol",
    title: "Screenshot read-back names the symbol",
    area: "Chat",
    href: "/dashboard",
    steps: ["Upload any chart screenshot.", "Read the first line of the reply."],
    expected: "The reply opens with 'Reading: SYMBOL TIMEFRAME' matching the uploaded image.",
  },
  {
    id: "combo-gate",
    title: "Time Frame Combo gate blocks counter-trend",
    area: "Scanner",
    href: "/signals",
    steps: [
      "Run the full watchlist scan.",
      "Find any instrument whose 4H direction is opposite the suggested bias.",
      "Open its scan detail and read the notes.",
    ],
    expected:
      "No card grades a setup that fights the 4H direction. Those read NO ENTRY with a 'Time Frame Combo step 1 failed' note. Setups missing 1H liquidity or a 15m BOS/ChoCH cap at B.",
  },
  {
    id: "signal-outcomes",
    title: "Signal history shows measured outcomes",
    area: "Signals",
    href: "/signals",
    steps: [
      "Open Signal history.",
      "Press 'Check outcomes' and wait for it to finish.",
      "Scan the rows and the header summary.",
    ],
    expected:
      "Rows render 'Hit TP xR', 'Stopped -1R', 'Open' or 'Not tracked'. The header shows hit count, stop count, hit rate and average R. Counter-trend rows carry the counter-trend badge. No console errors.",
  },
  {
    id: "scoreboard-tables",
    title: "Scoreboard counter-trend vs with-trend tables",
    area: "Scoreboard",
    href: "/scoreboard",
    steps: ["Open the Scoreboard page.", "Read the grade table and the counter-trend breakdown."],
    expected:
      "Both tables render real numbers: hit rate and average R per grade, and separate counter-trend vs with-trend buckets. Empty states read as 'no resolved signals yet', not as zeros pretending to be data.",
  },
  {
    id: "grade-caps",
    title: "Track record caps future grades",
    area: "Scanner",
    href: "/signals",
    steps: [
      "Confirm the scoreboard shows a losing counter-trend record.",
      "Re-run a scan on that instrument.",
    ],
    expected:
      "The scan notes state that past scans on that instrument have not paid, and the grade is capped accordingly (C for a losing record).",
  },
  {
    id: "scan-history",
    title: "Scan history persists in the thread",
    area: "Chat",
    href: "/chat",
    steps: [
      "Run a scan, then ask a follow-up question about it.",
      "Leave the page, come back, and reopen the same thread.",
      "Ask the coach to repeat the levels from the earlier scan.",
    ],
    expected:
      "The thread still contains the scan card and the coach quotes the earlier grade and levels back without you restating them.",
  },
  {
    id: "journal-record",
    title: "Journal records entry, stop, target and exit",
    area: "Journal",
    href: "/journal",
    steps: [
      "Log a trade from a scan with entry, stop and target filled.",
      "Set the mental state meter and save.",
      "Reload the page and open the trade in history.",
    ],
    expected:
      "Entry, stop, target, exit, P&L, R multiple and mental state all persist after reload, and 'AI chat' returns to the thread the trade was logged from.",
  },
];

const STORE_KEY = "trademind:admin-test-checklist";

type Saved = Record<string, { result: Result; note: string; at?: string }>;

export function TestChecklistPanel() {
  const [state, setState] = useState<Saved>({});
  const [openId, setOpenId] = useState<string | null>(CHECKS[0]?.id ?? null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setState(JSON.parse(raw) as Saved);
    } catch { /* first run */ }
  }, []);

  const persist = (next: Saved) => {
    setState(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  const mark = (id: string, result: Result) =>
    persist({ ...state, [id]: { note: state[id]?.note ?? "", result, at: new Date().toISOString() } });

  const setNote = (id: string, note: string) =>
    persist({ ...state, [id]: { result: state[id]?.result ?? null, note, at: state[id]?.at } });

  const counts = useMemo(() => {
    let pass = 0;
    let fail = 0;
    for (const c of CHECKS) {
      const r = state[c.id]?.result;
      if (r === "pass") pass += 1;
      else if (r === "fail") fail += 1;
    }
    return { pass, fail, total: CHECKS.length, left: CHECKS.length - pass - fail };
  }, [state]);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <ClipboardList className="h-4 w-4" /> Release test checklist
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Run these on the test account. Progress is stored on this device only.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <span className="text-bull font-semibold">{counts.pass} pass</span>
            <span className="text-destructive font-semibold">{counts.fail} fail</span>
            <span className="text-muted-foreground">{counts.left} left</span>
            <button
              onClick={() => persist({})}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 font-semibold hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          </div>
        </div>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-foreground transition-all"
            style={{ width: `${Math.round(((counts.pass + counts.fail) / counts.total) * 100)}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border">
        {CHECKS.map((c, i) => {
          const row = state[c.id];
          const open = openId === c.id;
          return (
            <div key={c.id} className="p-4">
              <button
                onClick={() => setOpenId(open ? null : c.id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    row?.result === "pass"
                      ? "bg-bull text-background"
                      : row?.result === "fail"
                        ? "bg-destructive text-background"
                        : "border border-border/60 text-muted-foreground"
                  }`}
                >
                  {row?.result === "pass" ? <Check className="h-3.5 w-3.5" /> : row?.result === "fail" ? <X className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-tight">{c.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{c.area}</span>
                </span>
              </button>

              {open && (
                <div className="mt-3 space-y-3 pl-9">
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                    {c.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-xs">
                    <span className="font-semibold">Expected: </span>
                    {c.expected}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={c.href}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open {c.area}
                    </a>
                    <button
                      onClick={() => mark(c.id, row?.result === "pass" ? null : "pass")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${row?.result === "pass" ? "bg-bull text-background" : "border border-border/60 hover:bg-muted"}`}
                    >
                      Pass
                    </button>
                    <button
                      onClick={() => mark(c.id, row?.result === "fail" ? null : "fail")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${row?.result === "fail" ? "bg-destructive text-background" : "border border-border/60 hover:bg-muted"}`}
                    >
                      Fail
                    </button>
                    {row?.at && (
                      <span className="text-[11px] text-muted-foreground">
                        Last marked {new Date(row.at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <textarea
                    value={row?.note ?? ""}
                    onChange={(e) => setNote(c.id, e.target.value)}
                    placeholder="What you saw (paste numbers, grade, or the error)"
                    rows={2}
                    className="w-full rounded-xl border border-border/60 bg-background p-3 text-xs outline-none focus:border-foreground/40"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

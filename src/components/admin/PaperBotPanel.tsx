// Phase 6 admin panel: start/pause/inspect the paper-only research bots.
// Everything on this card is simulated research — it never places live orders.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Play, Pause, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  adminListPaperBots,
  adminSavePaperBot,
  adminSetPaperBotStatus,
  adminRunPaperBotTick,
} from "@/lib/paper-bot.functions";

const SYMBOLS = ["XAU/USD", "NAS100", "US30", "EUR/USD", "GBP/USD", "USD/JPY", "BTC/USD", "ETH/USD"];

export function PaperBotPanel() {
  const queryClient = useQueryClient();
  const list = useServerFn(adminListPaperBots);
  const save = useServerFn(adminSavePaperBot);
  const setStatus = useServerFn(adminSetPaperBotStatus);
  const runTick = useServerFn(adminRunPaperBotTick);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-paper-bots"],
    queryFn: () => list(),
  });

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState(SYMBOLS[0]);
  const [timeframe, setTimeframe] = useState("60");
  const [tradeStyle, setTradeStyle] = useState<"scalp" | "intraday" | "swing">("intraday");
  const [minGrade, setMinGrade] = useState<"A+" | "A" | "B">("A");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-paper-bots"] });

  const createMutation = useMutation({
    mutationFn: () => save({ data: { name, symbol, timeframe, tradeStyle, minGrade } }),
    onSuccess: () => {
      toast.success("Paper bot created (paused by default)");
      setName("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create bot"),
  });

  const statusMutation = useMutation({
    mutationFn: (args: { id: string; status: "running" | "paused" }) => setStatus({ data: args }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const tickMutation = useMutation({
    mutationFn: (id: string) => runTick({ data: { id } }),
    onSuccess: (r) => {
      toast.success(r.ran ? "Tick complete" : "Bot is paused — start it first");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Tick failed"),
  });

  const bots = data?.bots ?? [];
  const trades = data?.trades ?? [];
  const events = data?.events ?? [];
  const closed = trades.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => t.result === "tp").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" /> Paper testing research bots
          </CardTitle>
          <CardDescription>
            Every bot below is paper testing only. Bots run the deterministic scanner and record every
            decision, skip, fill, and outcome for reproducibility. They cannot place real broker orders,
            and none of these results count toward live performance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              placeholder="Bot name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-48"
            />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {SYMBOLS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              <option value="15">15m</option>
              <option value="60">1H</option>
              <option value="240">4H</option>
              <option value="D">Daily</option>
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={tradeStyle} onChange={(e) => setTradeStyle(e.target.value as typeof tradeStyle)}>
              <option value="scalp">Scalp</option>
              <option value="intraday">Intraday</option>
              <option value="swing">Swing</option>
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={minGrade} onChange={(e) => setMinGrade(e.target.value as typeof minGrade)}>
              <option value="A+">A+ only</option>
              <option value="A">A or better</option>
              <option value="B">B or better</option>
            </select>
            <Button disabled={!name.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create bot
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading bots…</p>
          ) : bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paper bots yet. Create one above to begin forward testing.</p>
          ) : (
            <div className="space-y-2">
              {bots.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <span className="font-medium">{b.name}</span>
                  <Badge variant="outline">{b.symbol}</Badge>
                  <Badge variant="outline">{b.trade_style}</Badge>
                  <Badge variant="outline">min {b.min_grade}</Badge>
                  <Badge variant={b.status === "running" ? "default" : "secondary"}>{b.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {b.last_tick_at ? `last tick ${new Date(b.last_tick_at).toLocaleString()}` : "never ticked"}
                  </span>
                  <div className="ml-auto flex gap-2">
                    {b.status === "running" ? (
                      <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: b.id, status: "paused" })}>
                        <Pause className="mr-1 h-3 w-3" /> Pause
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => statusMutation.mutate({ id: b.id, status: "running" })}>
                        <Play className="mr-1 h-3 w-3" /> Start
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => tickMutation.mutate(b.id)}>
                      <Zap className="mr-1 h-3 w-3" /> Run tick
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paper results</CardTitle>
          <CardDescription>
            Paper testing only — not live performance. {closed.length} closed trades, {wins} targets hit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paper trades recorded yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {trades.slice(0, 25).map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
                  <Badge variant="secondary">PAPER</Badge>
                  <span className="font-medium">{t.symbol}</span>
                  <span>{t.side}</span>
                  <Badge variant="outline">{t.grade}</Badge>
                  <span className="text-muted-foreground">
                    {t.entry} → {t.exit_price ?? "open"}
                  </span>
                  {t.status === "closed" ? (
                    <span className={t.result === "tp" ? "text-green-500" : "text-red-500"}>
                      {t.result === "tp" ? "target" : "stop"} · {t.realized_r}R
                    </span>
                  ) : (
                    <span className="text-muted-foreground">open</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(t.opened_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Decision log</CardTitle>
          <CardDescription>Every scan, skip, entry, management action, and exit, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bot decisions recorded yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {events.slice(0, 30).map((e) => {
                const bot = bots.find((b) => b.id === e.bot_id);
                const detail = (e.detail ?? {}) as Record<string, unknown>;
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-2 rounded border px-2 py-1">
                    <Badge variant={e.kind === "enter" ? "default" : e.kind === "exit" ? "secondary" : "outline"}>
                      {e.kind}
                    </Badge>
                    <span className="font-medium">{bot?.name ?? "bot"}</span>
                    {typeof detail.grade === "string" && <Badge variant="outline">{detail.grade}</Badge>}
                    <span className="text-muted-foreground">
                      {(detail.reason as string) ?? (detail.note as string) ?? ""}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

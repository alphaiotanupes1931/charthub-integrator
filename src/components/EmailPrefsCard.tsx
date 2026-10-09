import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const PREFS = [
  { key: "morning_brief_email", label: "Morning picks", hint: "8 AM New York: the best A and B setups before the open." },
  { key: "scanner_wins_email", label: "Scanner wins", hint: "6 PM New York: setups that hit target today. Only sent when there are wins." },
  { key: "daily_profit_email", label: "Daily profit recap", hint: "5 PM New York: only on days your broker account finishes in profit." },
] as const;
type Key = (typeof PREFS)[number]["key"];

export function EmailPrefsCard({ userId }: { userId: string | null }) {
  const [vals, setVals] = useState<Record<Key, boolean> | null>(null);
  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("morning_brief_email, scanner_wins_email, daily_profit_email" as never).eq("id", userId).maybeSingle()
      .then(({ data }) => {
        const d = (data ?? {}) as Partial<Record<Key, boolean>>;
        setVals({ morning_brief_email: d.morning_brief_email !== false, scanner_wins_email: d.scanner_wins_email !== false, daily_profit_email: d.daily_profit_email !== false });
      });
  }, [userId]);

  async function toggle(key: Key, v: boolean) {
    if (!userId || !vals) return;
    setVals({ ...vals, [key]: v });
    const { error } = await supabase.from("profiles").update({ [key]: v } as never).eq("id", userId);
    if (error) { toast.error("Could not save"); setVals({ ...vals }); }
  }

  return (
    <div className="rounded-3xl border border-border/60 bg-card/60 p-5">
      <h2 className="text-lg font-semibold mb-1">Emails</h2>
      <p className="text-sm text-muted-foreground mb-4">Choose which TradeMind emails you get.</p>
      <div className="space-y-4">
        {PREFS.map((p) => (
          <label key={p.key} className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </span>
            <Switch checked={vals?.[p.key] ?? true} disabled={!vals} onCheckedChange={(v) => toggle(p.key, v)} />
          </label>
        ))}
      </div>
    </div>
  );
}

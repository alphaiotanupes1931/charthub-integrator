import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Archive, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  RETENTION_OPTIONS,
  applyRetentionNow,
  getRetentionSettings,
  setRetentionSettings,
} from "@/lib/retention.functions";

/**
 * Lets a trader choose how long scan history and scan cards stay in the active
 * History list. Expired threads are archived (hidden but recoverable), never
 * deleted, both by this panel's "Archive now" action and by the nightly job.
 */
export function RetentionSettingsPanel() {
  const load = useServerFn(getRetentionSettings);
  const save = useServerFn(setRetentionSettings);
  const applyNow = useServerFn(applyRetentionNow);

  const [days, setDays] = useState(0);
  const [archivedCount, setArchivedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await load();
      setDays(res.retentionDays);
      setArchivedCount(res.archivedCount);
    } catch {
      // Signed-out or offline: leave defaults.
    } finally {
      setLoaded(true);
    }
  }, [load]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleChange = async (value: number) => {
    const prev = days;
    setDays(value);
    setBusy(true);
    try {
      await save({ data: { retentionDays: value } });
      toast.success(value === 0 ? "Scan history kept forever" : `Scan history kept for ${value} days`);
    } catch {
      setDays(prev);
      toast.error("Could not save retention setting");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyNow = async () => {
    setBusy(true);
    try {
      const res = await applyNow();
      toast.success(
        res.archived > 0
          ? `Archived ${res.archived} conversation${res.archived === 1 ? "" : "s"}`
          : "Nothing outside your retention window yet",
      );
      await refresh();
    } catch {
      toast.error("Could not archive right now");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
        <Archive className="size-5 text-primary" />
        Scan history retention
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Choose how long scan conversations and their grade cards stay in your History list. Anything older is
        archived automatically each night, so it leaves History but is never deleted, and you can restore it any
        time from Archived in the chat sidebar.
      </p>
      <div className="max-w-sm mb-3">
        <Select
          value={String(days)}
          disabled={busy || !loaded}
          onChange={(e) => handleChange(Number(e.target.value))}
        >
          {RETENTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleApplyNow}
          disabled={busy || days === 0}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-2xl border border-border bg-card text-sm font-medium hover:bg-accent/40 transition disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          Archive now
        </button>
        <p className="text-xs text-muted-foreground font-mono">
          Archived: <span className="text-foreground">{archivedCount}</span>
        </p>
      </div>
    </Card>
  );
}

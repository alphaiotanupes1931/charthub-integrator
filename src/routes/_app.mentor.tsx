import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/PageHeader";
import { Users, Mail, Copy, Trash2, RefreshCw, Check, Loader2 } from "lucide-react";
import { createInvite, listMyInvites, revokeInvite, listRoster } from "@/lib/social.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/mentor")({
  head: () => ({ meta: [{ title: "Coach Dashboard, TradeMind" }] }),
  component: MentorPage,
});

type Invite = {
  id: string;
  code: string;
  note: string | null;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
};

type Mentee = {
  id: string;
  display_name: string | null;
  email: string | null;
  wins: number | null;
  losses: number | null;
  total: number;
  winRate: number;
};

function MentorPage() {
  const create = useServerFn(createInvite);
  const list = useServerFn(listMyInvites);
  const revoke = useServerFn(revokeInvite);
  const roster = useServerFn(listRoster);

  const [note, setNote] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [mentees, setMentees] = useState<Mentee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function refresh() {
    try {
      const [inv, ros] = await Promise.all([list(), roster()]);
      setInvites(inv as Invite[]);
      setMentees(ros as Mentee[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function inviteUrl(code: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/invite/${code}`;
  }

  async function generate() {
    setBusy(true);
    try {
      await create({ data: { note: note.trim() || undefined } });
      setNote("");
      await refresh();
      toast.success("Invite link created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create invite");
    } finally {
      setBusy(false);
    }
  }

  async function copy(inv: Invite) {
    try {
      await navigator.clipboard.writeText(inviteUrl(inv.code));
      setCopiedId(inv.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error("Copy failed - select the link manually");
    }
  }

  async function remove(id: string) {
    if (!confirm("Revoke this invite link?")) return;
    try {
      await revoke({ data: { id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Coach Dashboard"
        icon={<Users className="h-8 w-8 text-primary" />}
        description="Generate a shareable link, invite a trader, and see their win/loss stats once they accept."
      />

      <div className="rounded-xl border border-border/60 bg-card p-6 mb-4">
        <h2 className="flex items-center gap-2 font-semibold mb-1">
          <Mail className="h-4 w-4 text-primary" /> Generate an invite link
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Share the link with anyone. When they sign in and accept, you'll see each other's wins, losses, and win rate here.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. 'Trading buddy from London')"
            maxLength={120}
            className="flex-1 h-10 rounded-xl border border-border/60 bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
          <button
            onClick={generate}
            disabled={busy}
            className="rounded-xl bg-primary px-4 h-10 text-sm font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate link"}
          </button>
        </div>

        {invites.length > 0 && (
          <div className="mt-5 space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Your invite links</div>
            {invites.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                <code className="flex-1 min-w-0 text-xs font-mono truncate text-foreground/90">{inviteUrl(inv.code)}</code>
                {inv.accepted_by ? (
                  <span className="text-[10px] font-semibold tracking-tight text-bull bg-bull/10 px-2 py-0.5 rounded">
                    Accepted
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold tracking-tight text-muted-foreground bg-muted/40 px-2 py-0.5 rounded">
                    Pending
                  </span>
                )}
                <button onClick={() => copy(inv)} className="p-1.5 rounded-xl text-muted-foreground hover:text-foreground" title="Copy link">
                  {copiedId === inv.id ? <Check className="h-4 w-4 text-bull" /> : <Copy className="h-4 w-4" />}
                </button>
                <button onClick={() => remove(inv.id)} className="p-1.5 rounded-xl text-muted-foreground hover:text-destructive" title="Revoke">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Your roster ({mentees.length})</h2>
          <button onClick={refresh} className="text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : mentees.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No connected traders yet. Generate a link above and share it.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mentees.map((m) => (
              <div key={m.id} className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="font-semibold truncate">{m.display_name || m.email || "Trader"}</div>
                <div className="text-xs text-muted-foreground truncate mb-3">{m.email}</div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="text-bull font-medium">{m.wins ?? 0}W</span>
                    <span className="text-destructive font-medium">{m.losses ?? 0}L</span>
                  </div>
                  <span className="font-display text-lg text-primary">{m.winRate}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

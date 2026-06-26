import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Users, Copy, Check, Loader2, Share2 } from "lucide-react";
import { createInvite, listMyInvites, listRoster } from "@/lib/social.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/friends")({
  head: () => ({ meta: [{ title: "Friends, TradeMind" }] }),
  component: FriendsPage,
});

type Invite = {
  id: string;
  code: string;
  note: string | null;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
};

type Friend = {
  id: string;
  display_name: string | null;
  email: string | null;
  wins: number | null;
  losses: number | null;
  total: number;
  winRate: number;
};

function inviteUrl(code: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/invite/${code}`;
}

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  return src
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function FriendsPage() {
  const create = useServerFn(createInvite);
  const list = useServerFn(listMyInvites);
  const roster = useServerFn(listRoster);

  const [link, setLink] = useState<string>("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [inv, ros] = await Promise.all([list(), roster()]);
        if (cancelled) return;
        setFriends(ros as Friend[]);
        const existing = (inv as Invite[]).find((i) => !i.accepted_by);
        if (existing) {
          setLink(inviteUrl(existing.code));
        } else {
          // Auto-create a reusable invite so the page always has one link.
          const fresh = await create({ data: {} });
          if (!cancelled) setLink(inviteUrl(fresh.code));
        }
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateNew() {
    setBusy(true);
    try {
      const fresh = await create({ data: {} });
      setLink(inviteUrl(fresh.code));
      toast.success("New link generated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate link");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copy failed - select the link manually");
    }
  }

  async function shareLink() {
    if (!link) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Join me on TradeMind", url: link });
        return;
      } catch { /* user cancelled */ }
    }
    await copyLink();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <PageHeader
        title="Friends"
        icon={<Users className="h-8 w-8 text-primary" />}
        description="Share your link. When a trader accepts, they show up here automatically."
      />

      <Card className="space-y-4 p-5 md:p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Share2 className="h-4 w-4 text-primary" /> Your invite link
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1 truncate rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground">
            {loading ? "Generating…" : link || "-"}
          </div>
          <div className="flex gap-2">
            <Button onClick={copyLink} disabled={!link} variant="secondary" className="flex-1 sm:flex-none">
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button onClick={shareLink} disabled={!link} className="flex-1 sm:flex-none">
              <Share2 className="mr-2 h-4 w-4" /> Share
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Anyone with this link can connect with you.</span>
          <button
            onClick={generateNew}
            disabled={busy}
            className="text-primary hover:underline disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate new"}
          </button>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Connected ({friends.length})
        </h2>
        {loading ? (
          <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </Card>
        ) : friends.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            No friends yet. Share your link to get started.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {friends.map((f) => (
              <Card key={f.id} className="flex items-center gap-3 p-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {initials(f.display_name, f.email)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {f.display_name || f.email?.split("@")[0] || "Trader"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {f.wins ?? 0}W · {f.losses ?? 0}L · {f.winRate}% win rate
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

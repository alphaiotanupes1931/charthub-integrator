import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Brain, ThumbsUp, ThumbsDown, Sparkles, Trash2, Globe2, User2 } from "lucide-react";
import { listMyLessons, forgetLesson, getHermesStats } from "@/lib/agents/hermes.functions";

export const Route = createFileRoute("/_app/memory")({
  head: () => ({ meta: [{ title: "Trading Memory, TradeMind" }] }),
  component: MemoryPage,
});

function MemoryPage() {
  const statsFn = useServerFn(getHermesStats);
  const { data: stats } = useQuery({
    queryKey: ["hermes-stats"],
    queryFn: async () => {
      try {
        return await statsFn();
      } catch (error) {
        if (isAuthHeaderError(error)) return { helpful: 0, unhelpful: 0, total: 0, accuracy: null };
        throw error;
      }
    },
  });

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="My Trading Memory"
        icon={<Brain className="h-9 w-9 text-primary" />}
        description="Hermes - the learning layer - remembers your thumbs-up/down on every scan and distills a short lesson from each. Those lessons are injected into future scans so the AI adapts to how you actually trade."
      />

      <HermesMemoryPanel />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={<ThumbsUp className="h-4 w-4 text-bull" />}
          label="Helpful scans"
          value={stats ? String(stats.helpful) : "-"}
          hint="Times you thumbed-up a scan"
        />
        <StatCard
          icon={<ThumbsDown className="h-4 w-4 text-destructive" />}
          label="Unhelpful scans"
          value={stats ? String(stats.unhelpful) : "-"}
          hint="Times you thumbed-down a scan"
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4 text-primary" />}
          label="AI helpfulness"
          value={stats?.accuracy != null ? `${stats.accuracy}%` : "-"}
          hint="Share of scans you marked helpful"
        />
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-6">
        <h2 className="flex items-center gap-2 font-semibold mb-2">
          <Sparkles className="h-4 w-4 text-primary" /> AI calls, scored by your feedback
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Every thumbs-up or thumbs-down feeds Hermes. Patterns you like get reinforced; patterns you reject get down-weighted in future reads.
        </p>
        {stats && stats.total > 0 ? (
          <p className="text-sm text-foreground/90">
            <span className="font-semibold text-primary">{stats.total}</span> feedback events recorded so far.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No feedback yet. Rate a scan on the dashboard to start training Hermes.
          </p>
        )}
      </div>
    </div>
  );
}


function HermesMemoryPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listMyLessons);
  const forget = useServerFn(forgetLesson);

  const { data: lessons = [], isLoading, error } = useQuery({
    queryKey: ["hermes-lessons"],
    queryFn: async () => {
      try {
        return await list();
      } catch (error) {
        if (isAuthHeaderError(error)) return [];
        throw error;
      }
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => forget({ data: { id } }),
    onSuccess: () => {
      toast.success("Forgotten. Hermes won't apply it again.");
      qc.invalidateQueries({ queryKey: ["hermes-lessons"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not forget lesson."),
  });

  return (
    <div className="rounded-xl border border-border/60 bg-card p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Brain className="h-4 w-4 text-primary" /> Hermes memory
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Lessons distilled from your feedback. Higher weight = applied more strongly. Prune anything that's outdated or wrong - it's dropped from every future scan immediately.
          </p>
        </div>
        <span className="shrink-0 rounded-xl border border-border/60 bg-background/60 px-2 py-1 text-[10px] font-semibold tracking-tight text-muted-foreground">
          {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}
        </span>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground italic mt-4">Loading Hermes memory…</p>
      )}

      {error && !isLoading && (
        <p className="text-sm text-destructive mt-4">
          Couldn't load lessons: {error instanceof Error ? error.message : "unknown error"}
        </p>
      )}

      {!isLoading && !error && lessons.length === 0 && (
        <p className="text-sm text-primary/80 italic mt-4">
          No lessons yet. Thumbs-up or thumbs-down a scan on the dashboard and Hermes will start remembering what worked and what didn't.
        </p>
      )}

      {!isLoading && lessons.length > 0 && (
        <ul className="mt-4 divide-y divide-border/60">
          {lessons.map((l) => (
            <li key={l.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold tracking-tight text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 py-0.5">
                    {l.scope === "global" ? <Globe2 className="h-3 w-3" /> : <User2 className="h-3 w-3" />}
                    {l.scope}
                  </span>
                  <span className="inline-flex items-center rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-foreground/80">
                    {l.topic}
                  </span>
                  <span className="inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                    weight {l.weight}
                  </span>
                  <span className="ml-auto text-muted-foreground/70">
                    {new Date(l.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-foreground/90 leading-snug">{l.lesson}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Forget this lesson? It won't be applied to future scans.")) del.mutate(l.id);
                }}
                disabled={del.isPending || l.scope === "global"}
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground hover:text-destructive hover:border-destructive/60 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:border-border/60 transition"
                title={l.scope === "global" ? "Global lessons are curated and can't be pruned here" : "Forget this lesson"}
                aria-label="Forget lesson"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function isAuthHeaderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("no authorization header");
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2 text-xs tracking-tight text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-display text-4xl mt-3">{value}</div>
      <div className="text-xs text-muted-foreground mt-2">{hint}</div>
    </div>
  );
}

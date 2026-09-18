// Verify that filed signals still match the terms they were filed on, and seal
// rows that predate fingerprinting. Nothing is ever corrected here: a mismatch is
// reported so a human decides.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/signal-integrity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        const provided = request.headers.get("apikey");
        if (expected && provided !== expected) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 1000, 1000);
        // seal=1 writes fingerprints onto rows that predate the column. Those rows are
        // sealed from that moment forward; it cannot prove they were untouched before.
        const seal = url.searchParams.get("seal") === "1";
        const oldestFirst = url.searchParams.get("oldest") === "1";

        const { verifyIntegrity, fingerprintBackfill } = await import("@/lib/signal-integrity.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin
          .from("signal_scores")
          .select("id,symbol,timeframe,bias,grade,entry,stop,tp1,created_at,filed_hash")
          .order("created_at", { ascending: oldestFirst })
          .limit(limit);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const rows = (data ?? []).map((row) => ({
          id: String(row.id),
          symbol: String(row.symbol),
          timeframe: String(row.timeframe),
          bias: String(row.bias),
          grade: String(row.grade),
          entry: Number(row.entry),
          stop: Number(row.stop),
          tp1: Number(row.tp1),
          createdAt: String(row.created_at),
          filedHash: (row.filed_hash as string | null) ?? null,
        }));

        const report = verifyIntegrity(rows);

        let sealed = 0;
        if (seal) {
          const updates = fingerprintBackfill(rows);
          for (const update of updates) {
            const { error: writeError } = await supabaseAdmin
              .from("signal_scores")
              .update({ filed_hash: update.filed_hash } as never)
              .eq("id", update.id)
              .is("filed_hash", null);
            if (!writeError) sealed += 1;
          }
        }

        return Response.json({
          ...report,
          sealedNow: sealed,
          sealNote: seal
            ? "Rows sealed in this pass are sealed going forward only. Sealing cannot prove they were untouched before today."
            : "Read-only pass. Pass seal=1 to fingerprint rows that predate sealing.",
        });
      },
    },
  },
});

/**
 * Keys that let an outside tool file a signal into the record.
 *
 * TradingView alerts, n8n workflows or a trader's own script can post a signal to
 * the inbound endpoint. It is filed, sealed and resolved against real bars on
 * exactly the same terms as our own scans — the only difference is that its
 * `source` is not `engine`, so it never lands in the published track record.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type InboundKey = {
  id: string;
  label: string;
  /** Shown once at creation, then only as a prefix. */
  token: string | null;
  tokenPrefix: string;
  source: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

type Row = {
  id: string;
  label: string;
  token: string;
  source: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function toKey(row: Row, reveal = false): InboundKey {
  return {
    id: row.id,
    label: row.label,
    token: reveal ? row.token : null,
    tokenPrefix: `${row.token.slice(0, 10)}…`,
    source: row.source,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revoked: Boolean(row.revoked_at),
  };
}

export const listInboundKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InboundKey[]> => {
    const { data, error } = await context.supabase
      .from("signal_inbound_keys")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Row[]).map((r) => toKey(r));
  });

export const createInboundKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ label: z.string().min(1).max(60).default("Inbound signals"), source: z.string().min(2).max(24).default("webhook") }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<InboundKey> => {
    const { randomBytes } = await import("node:crypto");
    const token = `tmsig_${randomBytes(24).toString("base64url")}`;
    const { data: row, error } = await context.supabase
      .from("signal_inbound_keys")
      .insert({ user_id: context.userId, label: data.label, token, source: data.source } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    // Revealed exactly once: it is not retrievable afterwards.
    return toKey(row as unknown as Row, true);
  });

export const revokeInboundKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { error } = await context.supabase
      .from("signal_inbound_keys")
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

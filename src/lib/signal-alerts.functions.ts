// Read and save the trader's hourly scan alert settings.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ALERT_GRADES } from "@/lib/signal-alerts.shared";

type Ctx = { supabase: SupabaseClient; userId: string };

export interface SignalAlertPrefs {
  enabled: boolean;
  min_grade: string;
  symbols: string[];
  models: string[];
  timezone: string;
  quiet_from: number;
  quiet_to: number;
}

const DEFAULTS: SignalAlertPrefs = {
  enabled: false,
  min_grade: "A",
  symbols: ["XAU/USD", "EUR/USD", "NAS100"],
  models: ["classic"],
  timezone: "America/New_York",
  quiet_from: 22,
  quiet_to: 6,
};

export const getMySignalAlertPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { data, error } = await supabase
      .from("signal_alert_prefs")
      .select("enabled, min_grade, symbols, models, timezone, quiet_from, quiet_to")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { prefs: (data as SignalAlertPrefs | null) ?? DEFAULTS };
  });

const SaveInput = z.object({
  enabled: z.boolean(),
  min_grade: z.enum(ALERT_GRADES),
  symbols: z.array(z.string().min(1).max(20)).max(12),
  models: z.array(z.enum(["classic", "focus", "photon", "jablonski"])).min(1).max(4),
  timezone: z.string().min(1).max(64),
  quiet_from: z.number().int().min(0).max(23),
  quiet_to: z.number().int().min(0).max(23),
});

export const saveMySignalAlertPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("signal_alert_prefs")
      .upsert({ user_id: userId, ...data } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

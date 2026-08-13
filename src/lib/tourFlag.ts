import { supabase } from "@/integrations/supabase/client";

/**
 * Server-backed "has this account seen the intro tour?" flag.
 * localStorage alone was unreliable (cleared cookies / new device / new browser),
 * which made the tour reappear on almost every login. The profile column is the
 * source of truth; localStorage is only a fast local cache.
 */
const LOCAL_KEY = "trademind:tour:seen:v2";

function localSeen(): boolean {
  try {
    return !!localStorage.getItem(LOCAL_KEY);
  } catch {
    return false;
  }
}

function setLocalSeen() {
  try {
    localStorage.setItem(LOCAL_KEY, new Date().toISOString());
  } catch {
    /* noop */
  }
}

/** Returns true when the tour should be shown (never completed on this account). */
export async function shouldShowTour(legacyKeys: string[] = []): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Any legacy local flag counts as already seen, so existing users aren't re-prompted.
  for (const k of legacyKeys) {
    try {
      if (localStorage.getItem(k)) {
        void markTourSeen();
        return false;
      }
    } catch {
      /* noop */
    }
  }
  if (localSeen()) return false;

  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return false; // not signed in yet — don't show over a login screen

    const { data, error } = await supabase
      .from("profiles")
      .select("tour_completed_at")
      .eq("id", uid)
      .maybeSingle();

    if (error) return false; // fail closed: never nag on a lookup failure
    if (data?.tour_completed_at) {
      setLocalSeen();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Permanently records that this account finished (or skipped) the tour. */
export async function markTourSeen(): Promise<void> {
  setLocalSeen();
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) return;
    await supabase
      .from("profiles")
      .update({ tour_completed_at: new Date().toISOString() })
      .eq("id", uid);
  } catch {
    /* noop */
  }
}

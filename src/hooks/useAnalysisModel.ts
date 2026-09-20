import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_ANALYSIS_MODEL,
  normalizeAnalysisModel,
  type AnalysisModelId,
} from "@/lib/analysis-models";

const CACHE_KEY = "trademind.analysisModel.v1";
const EVENT = "trademind:analysis-model";

function readCache(): AnalysisModelId {
  if (typeof window === "undefined") return DEFAULT_ANALYSIS_MODEL;
  try {
    return normalizeAnalysisModel(window.localStorage.getItem(CACHE_KEY));
  } catch {
    return DEFAULT_ANALYSIS_MODEL;
  }
}

/** Read outside React (chat request builders run outside the render tree). */
export function readAnalysisModel(): AnalysisModelId {
  return readCache();
}

/**
 * The account's chosen analysis model. Saved on the profile so it follows the
 * person across devices, with a local copy so the chat request can name the
 * model without waiting on a round trip.
 */
export function useAnalysisModel() {
  const [modelId, setModelId] = useState<AnalysisModelId>(readCache);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("profiles")
        .select("analysis_model")
        .eq("id", u.user.id)
        .maybeSingle();
      if (!alive || !data) return;
      const next = normalizeAnalysisModel((data as { analysis_model?: string }).analysis_model);
      setModelId(next);
      try {
        window.localStorage.setItem(CACHE_KEY, next);
      } catch { /* ignore */ }
    })();
    const onChange = () => setModelId(readCache());
    window.addEventListener(EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  const select = useCallback(async (raw: string) => {
    const next = normalizeAnalysisModel(raw);
    setModelId(next);
    try {
      window.localStorage.setItem(CACHE_KEY, next);
      window.dispatchEvent(new Event(EVENT));
    } catch { /* ignore */ }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return { error: null as { message: string } | null };
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ analysis_model: next }).eq("id", u.user.id);
    setSaving(false);
    return { error };
  }, []);

  return { modelId, select, saving };
}

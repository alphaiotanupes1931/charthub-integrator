import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TraderProfileFlow } from "./TraderProfileFlow";
import { YourSetup } from "./YourSetup";
import { readDraft, readAttribution, type Draft } from "@/lib/trader-profile/draft";
import { getQuizDraft } from "@/lib/trader-profile.functions";
import { recommend } from "@/lib/trader-profile/score";
import { track } from "@/lib/product-events";
import type { Answers } from "@/lib/trader-profile/config";

/** In-app onboarding: reuses quiz answers when they exist, otherwise runs the flow, then shows Your Setup. */
export function TraderTypeOnboarding({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<"loading" | "flow" | "setup">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const fetchDraft = useServerFn(getQuizDraft);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readDraft();
      if (local?.answers && Object.keys(local.answers).length) {
        if (!cancelled) { setDraft(local); setState("setup"); }
        return;
      }
      const code = readAttribution().code;
      if (code) {
        try {
          const d = await fetchDraft({ data: { code } });
          if (d && !cancelled) { setDraft({ answers: d.answers as Answers, source: "public_quiz", code, ref: d.ref, utm: d.utm }); setState("setup"); return; }
        } catch { /* fall through to the flow */ }
      }
      if (!cancelled) setState("flow");
    })();
    return () => { cancelled = true; };
  }, [fetchDraft]);

  if (state === "loading") return <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>;

  if (state === "flow" || !draft) {
    return (
      <TraderProfileFlow
        mode="onboarding"
        onStart={(path) => track("profile_started", { path, where: "onboarding" })}
        onAnswer={(key) => track("profile_question_answered", { question: key, where: "onboarding" })}
        onComplete={(answers, source) => {
          track("profile_completed", { trader_type: recommend(answers).type, source });
          setDraft({ answers, source });
          setState("setup");
        }}
      />
    );
  }

  return (
    <YourSetup
      answers={draft.answers}
      source={draft.source}
      draftCode={draft.code}
      onDone={onDone}
      onRetake={() => { setDraft(null); setState("flow"); }}
    />
  );
}

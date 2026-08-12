import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, ChevronDown } from "lucide-react";

/**
 * One place for the "how do I use this page" copy. Keyed by pathname so
 * PageHeader can pick the right block up automatically and no page has to
 * repeat its own instructions.
 */
export const PAGE_INSTRUCTIONS: Record<string, { title: string; steps: string[] }> = {
  "/dashboard": {
    title: "How to use the dashboard",
    steps: [
      "Pick an instrument and a timeframe above the chart, then turn on the levels you trade.",
      "Press Run scan to grade the current setup, or attach a chart screenshot to grade that instead.",
      "Read the grade card: entry, stop, TP1, TP2 and risk to reward. A grade of NO ENTRY means stand down.",
      "Press I am taking this trade to log it in the journal. Every signal is checked against past price history automatically.",
      "Ask the coach follow-up questions in the Chat tab; it sees the same scan you are looking at.",
    ],
  },
  "/scoreboard": {
    title: "How to read the signal scoreboard",
    steps: [
      "Every scan with an entry, stop and target is filed here automatically. You do not have to tag anything.",
      "Each filed signal is checked against real price bars: whichever printed first, the stop or the first target, decides the outcome.",
      "If a bar contains both the stop and the target, it counts as a stop. That keeps the numbers honest rather than flattering.",
      "Hit rate only counts signals that reached a stop or target. Expired means the signal ran out of time without touching either.",
      "Compare the breakdowns: if one instrument or timeframe has negative average R over enough signals, trade it smaller or drop it.",
      "Taken versus skipped shows whether your own filtering helps. If skipped beats taken, your selection is cutting the good ones.",
    ],
  },
  "/autopilot": {
    title: "How to use autopilot",
    steps: [
      "Set the watchlist, the minimum grade and the risk per trade you are willing to hand over.",
      "Choose the account: paper for testing, or a connected broker for live routing.",
      "Autopilot scans on a schedule and queues any setup that clears your grade filter.",
      "Queued setups wait for your approval unless you turn on auto-execute, so nothing fires without a rule you set.",
      "Check the activity log after each session to see what was taken, skipped and why.",
    ],
  },
  "/calculator": {
    title: "How to use the risk calculator",
    steps: [
      "Enter your account balance and the percentage of it you are willing to lose on this trade.",
      "Enter the entry and stop price. The distance between them is your risk per unit.",
      "The calculator returns position size, the cash at risk and what each R is worth.",
      "Add a target to see the reward to risk before you commit. Below 1:2 usually is not worth taking.",
    ],
  },
  "/journal": {
    title: "How to use the journal",
    steps: [
      "Trades logged from a scan appear here automatically; anything else you add by hand.",
      "Fill in the exit price when the trade closes so profit and loss and R are computed correctly.",
      "Rate your mental state with each entry. Over time it shows which state your losses come from.",
      "Export to CSV or JSON regularly. That file is your backup.",
    ],
  },
  "/signals": {
    title: "How to use signal history",
    steps: [
      "Every scan the engine produced is stored here with its grade, levels and timestamp.",
      "Filter by instrument or grade to see whether your best grades actually behave best.",
      "Open any row to reload that setup on the chart.",
    ],
  },
  "/alerts": {
    title: "How to use alerts",
    steps: [
      "Add a price level and choose whether it triggers above or below the current price.",
      "Alerts are checked on a schedule and delivered to the channels you have connected.",
      "Delete a level once it has fired so the list stays readable.",
    ],
  },
  "/news": {
    title: "How to use the news page",
    steps: [
      "The list is the economic calendar for the current week, newest first.",
      "Red impact means the release moves price. Do not hold size into one on your instrument.",
      "Times follow the timezone you set in Settings.",
    ],
  },
  "/broker": {
    title: "How to use the broker page",
    steps: [
      "Connect a venue on the Connections page first, then pick it here.",
      "Deep links from a scan card prefill instrument, side, entry, stop and target.",
      "Check size and stop before you send. Orders go straight to the venue you selected.",
    ],
  },
  "/connections": {
    title: "How to use connections",
    steps: [
      "Pick a venue and paste its API credentials. They are encrypted before they are stored.",
      "Press verify: a successful read of your account balance means the connection works.",
      "Venues marked as tradable can route orders; the rest are read only.",
    ],
  },
  "/mental": {
    title: "How to use the mental state page",
    steps: [
      "Score how you feel before you trade, not after.",
      "The same meter is built into the journal entry form, so scoring a trade covers both.",
      "Look for the pattern: the state you were in before your worst trades is the one to trade smaller in.",
    ],
  },
  "/strategies": {
    title: "How to use playbooks",
    steps: [
      "A playbook describes the setups you are allowed to take and the ones you are not.",
      "Set one active. The scanner and the coach then grade against it instead of generic rules.",
      "Measure a playbook in the backtest, then keep or change it based on expectancy.",
    ],
  },
  "/scan-lens": {
    title: "How to use scan lenses",
    steps: [
      "A lens changes what the scanner emphasises: structure, liquidity, momentum or order flow.",
      "Choose the lens that matches how you actually trade, then run a scan.",
      "The active lens is shown on the grade card so you always know what produced it.",
    ],
  },
  "/memory": {
    title: "How to use coach memory",
    steps: [
      "Anything stored here is fed to the coach on every conversation and scan.",
      "Add your rules, sizing limits and repeated mistakes so the coaching stays specific.",
      "Delete entries that are no longer true; stale memory produces stale advice.",
    ],
  },
  "/analytics": {
    title: "How to read your analytics",
    steps: [
      "Numbers come from your journal, so they are only as good as your logging.",
      "Start with expectancy per instrument and per session, then look at hold time.",
      "One bad month is noise. A negative expectancy across 50 trades is a rule problem.",
    ],
  },
  "/discord": {
    title: "How to set up Discord",
    steps: [
      "Join the server with the invite on this page.",
      "In the briefings channel, set your timezone and your morning and evening hours.",
      "Choose which instruments you want briefings for; you receive only those.",
    ],
  },
  "/testing": {
    title: "How to use testing mode",
    steps: [
      "Testing mode opens a paper account with the same views as a live account.",
      "The banner at the top tells you when you are in it, so no order can be mistaken for real.",
      "Reset the account whenever you want a clean set of numbers.",
    ],
  },
  "/levels": {
    title: "How to use levels",
    steps: [
      "Turn on the level types you trade; the chart draws only those.",
      "Levels feed the scanner, so fewer and better levels give cleaner grades.",
    ],
  },
  "/guide": {
    title: "How to use the guide",
    steps: [
      "Work top to bottom the first time; each section builds on the previous one.",
      "Every section links to the page it describes so you can try it as you read.",
    ],
  },
  "/mentor": {
    title: "How to use the mentor",
    steps: [
      "Describe the trade or the habit you want reviewed, in your own words.",
      "The mentor reads your journal and active playbook, so be honest in both.",
    ],
  },
  "/coaches": {
    title: "How to use coaches",
    steps: [
      "Each coach has a different tone and focus. Set one active.",
      "The active coach writes the commentary on your scans and chat replies.",
    ],
  },
  "/flashcards": {
    title: "How to use flashcards",
    steps: [
      "Cards come from the academy modules you have started.",
      "Answer before you flip. Cards you miss come back sooner.",
    ],
  },
  "/leaderboard": {
    title: "How to read the leaderboard",
    steps: [
      "Ranking uses journaled results, not screenshots.",
      "Consistency is scored alongside return, so one lucky month will not top it.",
    ],
  },
  "/friends": {
    title: "How to use friends",
    steps: [
      "Add someone to compare journaled stats and share setups.",
      "Nothing is shared until you add them.",
    ],
  },
  "/academy": {
    title: "How to use the academy",
    steps: [
      "Modules run in order; each ends with a short check.",
      "Pass the exam for a module to unlock its certificate.",
    ],
  },
  "/first-week": {
    title: "How to use your first week",
    steps: [
      "One task per day. Do them in order.",
      "Each task links to the page you need, so nothing is left to guess.",
    ],
  },
  "/settings": {
    title: "How to use settings",
    steps: [
      "Set your timezone first; every chart, alert and briefing time follows it.",
      "Set default risk per trade so the calculator and autopilot start from your number.",
    ],
  },
};

export function PageInstructions({
  path,
  className = "",
}: {
  path?: string;
  className?: string;
}) {
  const routerPath = useRouterState({ select: (s) => s.location.pathname });
  const key = path ?? routerPath;
  const entry =
    PAGE_INSTRUCTIONS[key] ??
    PAGE_INSTRUCTIONS[Object.keys(PAGE_INSTRUCTIONS).find((k) => k !== "/" && key.startsWith(k)) ?? ""];
  const [open, setOpen] = useState(false);
  if (!entry) return null;

  return (
    <div className={`rounded-md border border-border bg-card ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <HelpCircle className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">{entry.title}</span>
        <motion.span
          className="ml-auto text-muted-foreground"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ol className="list-decimal space-y-1.5 border-t border-border px-3 py-3 pl-8 text-xs leading-relaxed text-muted-foreground">
              {entry.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default PageInstructions;

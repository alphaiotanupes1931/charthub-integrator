# Phase 4: Performance Intelligence & Weekly Review

The app now collects trades, signals, journal notes, mental-state checks, and paper-account P&L. The next phase turns that raw data into trader-facing insights that drive behavior change.

## What we build

### 1. Analytics dashboard (new page)

`/analytics` becomes the single place a trader reviews how they are actually performing.

- **Equity curve**: P&L over time from journal + paper trades + closed autopilot proposals.
- **Win rate by day / session / instrument / grade**: which conditions produce edge.
- **R-multiple distribution**: average winner vs. average loser, expectancy, profit factor.
- **Mental-state correlation**: P&L and win rate grouped by pre-trade mental-health score.
- **Grade follow-through**: win rate of A/A+ setups the trader actually took vs. skipped.
- **Drawdown / streaks**: consecutive losses, max drawdown, recovery days.

Charts stay flat/neutral, using the existing design system (1px borders, `rounded-md`, no gradients).

### 2. Sunday prep report

Auto-generated every Sunday or on-demand from `/analytics`:

- Last week's closed trades, P&L, and win rate.
- Best and worst setups, with the lesson text from the journal.
- One concrete rule to follow next week based on the losing buckets.
- Watchlist from the user's saved instruments.

Stored in `weekly_reports` so it can be viewed later and sent to Telegram/Discord if configured.

### 3. Trade review checklist

After a trade is closed (manual journal entry, paper trade close, or autopilot fill), prompt the trader to answer 3 questions:

- Did I follow my plan? (yes / partial / no)
- Did the grade match the outcome? (A/A+ worked, B/C failed, etc.)
- What would I do identically next time?

Answers are stored on the journal row and feed the Sunday report.

### 4. Shared signal-engine context

Make sure `runPlan`, backtest engine, and autopilot scanner all read the same performance context:

- Current week's win rate / expectancy.
- Recent losing buckets from the learning report.
- Active strategy edge from `strategy_performance`.

This prevents the AI coach from giving generic advice while the trader is bleeding in a specific bucket.

### 5. Live-performance feed on the dashboard

Add a small panel to `/dashboard` that shows the current week at a glance:

- Trades taken / closed this week.
- Net P&L and R.
- Current drawdown from peak.
- One-sentence coaching nudge from the learning report.

## Data model

```text
weekly_reports        user_id, week_ending, metrics_json, lesson, created_at
journal_reviews       journal_id, followed_plan, grade_match, takeaway
paper_equity_curve    already exists; surface it in analytics
```

## Rollout order

1. Backend aggregators: compute weekly stats from journal + paper trades + autopilot proposals.
2. `/analytics` page with equity curve, win-rate breakdowns, and mental-state correlation.
3. Sunday prep report generator + storage.
4. Trade review checklist added to journal entry and close flows.
5. Dashboard live-performance panel.
6. QA: verify numbers match journal P&L, that paper trades are included, and that mental-state grouping is accurate.

## Success metric

A trader can open `/analytics` on Sunday and in under 60 seconds know: what worked, what didn't, and what to change next week.

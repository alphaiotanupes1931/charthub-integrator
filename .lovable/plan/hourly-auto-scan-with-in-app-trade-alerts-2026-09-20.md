# Hourly auto-scan with in-app trade alerts

Yes, this is possible — most of the machinery already exists. A scheduled job already
scans a fixed list every 15 minutes and posts strong setups to the community Discord
feed, and the app already has a notification bell with a stored inbox. What's missing
is a personal version: your chosen scan model, your instruments, your grade rule, and
an alert that lands in your own inbox.

## What you'll get

- A scan that runs automatically once an hour, right after the hourly candle closes.
- An alert in the app's bell for each setup that passes your rule, e.g. "A · BUY
  XAU/USD — entry, stop, first target, confidence". Tapping it opens that setup.
- Your own settings page section: turn alerts on/off, pick the minimum grade
  (A+ only / A and better / B and better), pick which instruments to watch, and pick
  which scan model decides (Classic, The Trading Channel, Photon Trading).
- Quiet hours in your own timezone, so nothing pings you overnight.
- No duplicates: one alert per instrument, direction and candle — re-runs stay silent.

## Rules the alert must pass

An alert only fires when all of these are true, which is the "all the rules are
checked and the grade is A" behaviour you described:

1. The scan model produced a real direction (not "no entry", not neutral).
2. Its grade meets or beats your minimum grade.
3. The setup is confirmed on the closed candle, not a forming one.
4. Price is still near the planned entry zone, so you're not alerted to a move that
   already left without you.

Anything that fails those checks is recorded as "watching", not as an alert.

## Technical notes

- New table `signal_alert_prefs` (user_id PK, enabled, min_grade, symbols text[],
  models text[], timezone, quiet_from/quiet_to, created/updated) with owner-only RLS
  and the standard grants; server-side reads use the admin client.
- New cron route `src/routes/api/public/hooks/signal-alerts-tick.ts`, hourly at :01,
  keyed by the publishable apikey header like the existing hooks. It collects the
  union of (symbol, model) pairs across enabled prefs, runs each pair **once** through
  `getSnapshot` + the model's engine/planner (Classic via `runResearch`/`runPlanner`,
  the other models via their deterministic engines), then fans results out per user.
- Gate each result through the existing closed-bar confirmation and
  `evaluateEntryStaleness` before it becomes an alert.
- Deliver with `createNotificationOnce` using dedupe key
  `signal:{model}:{symbol}:{bias}:{barCloseIso}`, kind `signal`, url pointing at the
  dashboard for that symbol, and the plan levels in `meta`.
- Add a pg_cron migration for the hourly schedule; leave the existing 15-minute
  Discord `scan-signals` job untouched.
- UI: an "Hourly scan alerts" card on `src/routes/_app.alerts.tsx` plus a server
  function pair in `src/lib/signal-alerts.functions.ts` for reading/saving prefs.
- Tests: grade threshold, stale-entry rejection, quiet hours, dedupe across re-runs,
  and per-model routing — all on fixed fixtures, no network.

## Out of scope for this pass

Email/Discord/Telegram delivery of the personal alert (the inbox first), and any
change to how grades are produced — alerting doesn't touch the scoring work.

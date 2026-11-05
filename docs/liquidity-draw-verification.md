# Liquidity draw rollout — Nov 5, 2026

Classic scans on the named OANDA rollout now use `liquidity_draw_proximal`.
Other named analysis models and frozen v2 candidate prices are unchanged.

## Verified
- Shared prefix-only pool mapping on 15m, 1H, 4H and Daily; consumption checked on closed 15m bars.
- Durable symbol/exact-host/mid-price draw state with optimistic version updates.
- Confirmed sweep plus closed 15m swing break; rescans do not let Daily/4H flip the draw.
- Proximal fresh-zone entries; initial sweep stops and continuation zone stops with buffers.
- Ordered pool targets, with HTF final target recorded separately.
- A/B/C ceilings and full/half/quarter risk; owner-scoped saved scan supplies popup sizing.
- Missing one-feed data, stale snapshots, missing continuity and missing zones do not produce executable entries.
- Signed-in Gold dashboard scan showed OANDA Live/mid, invalidated draw, no entry, no browser errors; state and scan record read back from storage.
- 892 unit tests passed across 106 files, including 19 draw acceptance tests and the 32 frozen entry tests.

## Limitations
The Nov 3–4 tests use explicitly labelled event-level OANDA values from Marcus's addendum. They are acceptance regressions, not a downloaded OHLC replay or profitability backtest. No profit improvement has been established. No broker orders were submitted during verification. Publishing has not been performed in this task.

Pool session windows currently use explicit six-hour UTC buckets. Nested HTF zones use the shared order-block detector. If saved state predates available 15m history, the scan refuses to reuse an unverified lock rather than guessing across the missing interval.
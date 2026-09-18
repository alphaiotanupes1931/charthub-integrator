/**
 * Public track record. Anyone, signed in or not, can read this page and check the
 * numbers themselves. Every figure carries the count it was computed from, net is
 * shown beside gross, and the limits of the data are printed on the page rather
 * than implied away.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getPublicRecord, type PublicRecordRow } from "@/lib/public-record.functions";
import { tfLabel, type ScoreBucket } from "@/lib/signal-scores.shared";

export const Route = createFileRoute("/record")({
  head: () => ({
    meta: [
      { title: "Verified track record, TradeMind" },
      {
        name: "description",
        content:
          "Every signal TradeMind has filed, sealed at the moment it was filed and resolved against real price bars. Net of estimated costs, with the sample size on every figure.",
      },
      { property: "og:title", content: "Verified track record, TradeMind" },
      {
        property: "og:description",
        content:
          "An append-only record of filed signals resolved against real bars, reported net of estimated costs with the sample size attached to every number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: () => getPublicRecord({ data: {} }),
  errorComponent: () => (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-2xl">The record could not be loaded</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Please try again in a moment. Nothing in the record changes when this page fails to load.
      </p>
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-2xl">Not found</h1>
    </main>
  ),
  component: RecordPage,
});

function Figure({ label, value, n, sub }: { label: string; value: string; n?: number; sub?: string }) {
  return (
    <div className="border border-border/60 p-4">
      <div className="text-xs tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl">{value}</div>
      {n != null && <div className="mt-0.5 font-mono text-xs text-muted-foreground">n = {n}</div>}
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function r(v: number | null | undefined) {
  return v == null ? "-" : `${v}R`;
}

function GradeTable({ buckets }: { buckets: ScoreBucket[] }) {
  if (!buckets.length) return <p className="mt-3 text-sm text-muted-foreground">No resolved signals yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Grade</th>
            <th className="py-2 pr-3 font-normal">Decided (n)</th>
            <th className="py-2 pr-3 font-normal">Hit</th>
            <th className="py-2 pr-3 font-normal">Stopped</th>
            <th className="py-2 pr-3 font-normal">Expired</th>
            <th className="py-2 pr-3 font-normal">Hit rate</th>
            <th className="py-2 pr-3 font-normal">Avg R net</th>
            <th className="py-2 font-normal">Avg R gross</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {buckets.map((b) => (
            <tr key={b.key}>
              <td className="py-2 pr-3">{b.key}</td>
              <td className="py-2 pr-3 font-mono">{b.decided}</td>
              <td className="py-2 pr-3 font-mono">{b.targets}</td>
              <td className="py-2 pr-3 font-mono">{b.stops}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">{b.expired || "-"}</td>
              <td className="py-2 pr-3 font-mono">{b.decided ? `${b.hitRate}%` : "-"}</td>
              <td className="py-2 pr-3 font-mono">
                {r(b.netExpectancyR)} {b.netCount ? <span className="text-muted-foreground">({b.netCount})</span> : null}
              </td>
              <td className="py-2 font-mono text-muted-foreground">{b.decided ? r(b.expectancyR) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowTable({ rows }: { rows: PublicRecordRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Filed</th>
            <th className="py-2 pr-3 font-normal">Market</th>
            <th className="py-2 pr-3 font-normal">TF</th>
            <th className="py-2 pr-3 font-normal">Side</th>
            <th className="py-2 pr-3 font-normal">Grade</th>
            <th className="py-2 pr-3 font-normal">Entry</th>
            <th className="py-2 pr-3 font-normal">Stop</th>
            <th className="py-2 pr-3 font-normal">Target</th>
            <th className="py-2 pr-3 font-normal">Outcome</th>
            <th className="py-2 pr-3 font-normal">Net R</th>
            <th className="py-2 pr-3 font-normal">Gross R</th>
            <th className="py-2 pr-3 font-normal">Heat / best</th>
            <th className="py-2 font-normal">Seal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={`${row.filedAt}-${i}`}>
              <td className="py-2 pr-3 font-mono text-muted-foreground">{row.filedAt.slice(0, 10)}</td>
              <td className="py-2 pr-3">{row.symbol}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">{tfLabel(row.timeframe)}</td>
              <td className="py-2 pr-3">{row.bias}</td>
              <td className="py-2 pr-3">{row.grade}</td>
              <td className="py-2 pr-3 font-mono">{row.entry}</td>
              <td className="py-2 pr-3 font-mono">{row.stop}</td>
              <td className="py-2 pr-3 font-mono">{row.tp1}</td>
              <td className="py-2 pr-3">{row.status}</td>
              <td className="py-2 pr-3 font-mono">{r(row.netR)}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">{r(row.realizedR)}</td>
              <td className="py-2 pr-3 font-mono text-muted-foreground">
                {r(row.maeR)} / {r(row.mfeR)}
              </td>
              <td className="py-2 font-mono text-muted-foreground">{row.seal ?? "unsealed"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordPage() {
  const record = Route.useLoaderData();
  const b = record.scoreboard;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link to="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Home
      </Link>

      <header className="mt-6">
        <h1 className="text-3xl">Verified track record</h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          Every signal is filed before the outcome is known, sealed with a fingerprint of its entry, stop, target,
          direction and grade, then resolved against real closed price bars. Terms cannot be edited after filing without
          the seal no longer matching. Figures below are net of estimated costs first, with gross beside them and the
          sample size attached to every number.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 border border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {record.integrity.sealed} of {record.integrity.published} published signals carry a filing seal
          {record.integrity.unsealed ? `, ${record.integrity.unsealed} predate sealing` : ""}
        </p>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Resolved" value={String(b.decided)} sub={`${b.targets} hit, ${b.stops} stopped`} />
        <Figure label="Hit rate" value={b.decided ? `${b.hitRate}%` : "-"} n={b.decided} />
        <Figure
          label="Average R, net"
          value={r(b.netExpectancyR)}
          n={b.netCount}
          sub={b.avgCostR == null ? undefined : `after ${b.avgCostR}R estimated cost`}
        />
        <Figure label="Average R, gross" value={r(b.expectancyR)} n={b.decided} />
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        {`${b.expired} ${b.expired === 1 ? "signal" : "signals"} expired without reaching either level`}
        {b.expiredAvgR == null ? "" : ` (average ${b.expiredAvgR}R)`}
        {`. ${b.open} still open. ${b.voided} filed with no directional read and excluded from every figure. Resolved, expired, open and excluded add up to ${
          b.decided + b.expired + b.open + b.voided
        }, the most recent signals filed. Older signals stay in the record and are audited separately.`}
      </p>

      <section className="mt-10">
        <h2 className="text-sm tracking-wide text-muted-foreground">By grade</h2>
        <GradeTable buckets={b.byGrade} />
      </section>

      <section className="mt-10">
        <h2 className="text-sm tracking-wide text-muted-foreground">What this record does not claim</h2>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          {record.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm tracking-wide text-muted-foreground">
          Every published signal ({record.rows.length})
        </h2>
        <RowTable rows={record.rows} />
      </section>
    </main>
  );
}

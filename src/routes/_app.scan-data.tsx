import { createFileRoute } from "@tanstack/react-router";
import { DailyScanLog } from "@/components/DailyScanLog";

export const Route = createFileRoute("/_app/scan-data")({
  head: () => ({
    meta: [
      { title: "Scan Data, TradeMind" },
      { name: "description", content: "Every scan you ran, its price source, grade caps and how it played out." },
      { property: "og:title", content: "Scan Data, TradeMind" },
      { property: "og:description", content: "Every scan you ran, its price source, grade caps and how it played out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanDataPage,
});

function ScanDataPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Scan Data</h1>
        <p className="text-sm text-muted-foreground">
          Every scan saved to your account: the call, grade, price source, what held the grade down, and how price played out. Pick a day to review it.
        </p>
      </div>
      <DailyScanLog />
    </div>
  );
}

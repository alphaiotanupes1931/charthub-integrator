import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TraderTypeOnboarding } from "@/components/trader-profile/TraderTypeOnboarding";

export const Route = createFileRoute("/_app/trader-type")({
  head: () => ({
    meta: [
      { title: "Your Trader Type — TradeMind" },
      { name: "description", content: "Find your trader type and get a coach, starter strategy, risk rails and first-week plan set up for you." },
      { property: "og:title", content: "Your Trader Type — TradeMind" },
      { property: "og:description", content: "Find your trader type and get your setup in minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TraderTypePage,
});

function TraderTypePage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-md mx-auto py-4">
      <TraderTypeOnboarding onDone={() => navigate({ to: "/first-week" })} />
    </div>
  );
}

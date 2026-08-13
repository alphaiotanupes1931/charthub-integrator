import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignals from "./tools/list-signals";
import getMarketPrice from "./tools/get-market-price";
import createPriceAlert from "./tools/create-price-alert";
import listPriceAlerts from "./tools/list-price-alerts";

const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "trademind-integrator",
  title: "ChartHub Integrator",
  version: "0.1.0",
  instructions:
    "Tools for TradeMind. Use `get_market_price` for live OANDA prices and technical stats, `list_signals` for recent graded setups from the signal engine, and `list_price_alerts` / `create_price_alert` to read and set the signed-in trader's price alerts.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMarketPrice, listSignals, listPriceAlerts, createPriceAlert],
});

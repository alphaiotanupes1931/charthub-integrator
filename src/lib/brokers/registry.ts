// Client-safe broker catalog. No secrets, no server imports.
// Every broker here maps to an adapter in src/lib/brokers/adapters.server.ts.

export type CredField = {
  key: "apiKey" | "apiSecret" | "passphrase" | "accountId" | "username" | "password" | "token";
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
};

export type BrokerAsset = "forex" | "indices" | "futures" | "stocks" | "options" | "crypto" | "metals";

export type BrokerDef = {
  id: string;
  name: string;
  group: "Forex / CFD" | "Stocks / Futures" | "Crypto";
  assets: BrokerAsset[];
  /** false = credentials can be stored but we cannot verify or trade over a public REST API */
  testable: boolean;
  /** we can place orders through this adapter */
  trading: boolean;
  envs?: Array<{ value: string; label: string }>;
  fields: CredField[];
  docsUrl: string;
  notes: string;
};

const KEY: CredField = { key: "apiKey", label: "API key", secret: true };
const SECRET: CredField = { key: "apiSecret", label: "API secret", secret: true };
const PASS: CredField = { key: "passphrase", label: "API passphrase", secret: true };
const ACCOUNT: CredField = { key: "accountId", label: "Account ID", optional: true };

const LIVE_DEMO = [
  { value: "practice", label: "Demo / paper" },
  { value: "live", label: "Live" },
];

export const BROKERS: BrokerDef[] = [
  {
    id: "oanda",
    name: "OANDA",
    group: "Forex / CFD",
    assets: ["forex", "indices", "metals"],
    testable: true,
    trading: true,
    envs: LIVE_DEMO,
    fields: [KEY, ACCOUNT],
    docsUrl: "https://developer.oanda.com/rest-live-v20/introduction/",
    notes: "Personal access token from Manage API Access. Full order routing from scans.",
  },
  {
    id: "capitalcom",
    name: "Capital.com",
    group: "Forex / CFD",
    assets: ["forex", "indices", "crypto", "metals"],
    testable: true,
    trading: true,
    envs: LIVE_DEMO,
    fields: [KEY, { key: "username", label: "Login email" }, { key: "password", label: "API password", secret: true }],
    docsUrl: "https://open-api.capital.com/",
    notes: "Generate an API key in Settings, API integrations. Demo keys work with the demo host.",
  },
  {
    id: "ig",
    name: "IG Markets",
    group: "Forex / CFD",
    assets: ["forex", "indices", "stocks", "metals"],
    testable: true,
    trading: false,
    envs: LIVE_DEMO,
    fields: [KEY, { key: "username", label: "Username" }, { key: "password", label: "Password", secret: true }],
    docsUrl: "https://labs.ig.com/rest-trading-api-reference",
    notes: "Uses the IG REST session endpoint. Demo keys are separate from live keys.",
  },
  {
    id: "metaapi",
    name: "MetaTrader 4/5 (MetaApi)",
    group: "Forex / CFD",
    assets: ["forex", "indices", "metals"],
    testable: true,
    trading: false,
    fields: [{ key: "token", label: "MetaApi auth token", secret: true }, ACCOUNT],
    docsUrl: "https://metaapi.cloud/docs/provisioning/",
    notes: "Bridges any MT4/MT5 account. Add your MetaApi token and the provisioned account ID.",
  },
  {
    id: "deriv",
    name: "Deriv",
    group: "Forex / CFD",
    assets: ["forex", "indices", "crypto"],
    testable: true,
    trading: false,
    fields: [{ key: "token", label: "API token", secret: true }],
    docsUrl: "https://developers.deriv.com/",
    notes: "Create a token with read and trade scopes in Deriv API settings.",
  },
  {
    id: "alpaca",
    name: "Alpaca",
    group: "Stocks / Futures",
    assets: ["stocks", "options", "crypto"],
    testable: true,
    trading: true,
    envs: [
      { value: "practice", label: "Paper" },
      { value: "live", label: "Live" },
    ],
    fields: [KEY, SECRET],
    docsUrl: "https://docs.alpaca.markets/",
    notes: "Paper and live keys are different. Stocks, options and crypto order routing.",
  },
  {
    id: "tradier",
    name: "Tradier",
    group: "Stocks / Futures",
    assets: ["stocks", "options"],
    testable: true,
    trading: true,
    envs: [
      { value: "practice", label: "Sandbox" },
      { value: "live", label: "Live" },
    ],
    fields: [{ key: "token", label: "Access token", secret: true }, ACCOUNT],
    docsUrl: "https://documentation.tradier.com/",
    notes: "Bearer access token from your Tradier dashboard.",
  },
  {
    id: "tastytrade",
    name: "Tastytrade",
    group: "Stocks / Futures",
    assets: ["stocks", "options", "futures"],
    testable: true,
    trading: true,
    envs: [
      { value: "practice", label: "Sandbox" },
      { value: "live", label: "Live" },
    ],
    fields: [{ key: "username", label: "Username" }, { key: "password", label: "Password", secret: true }],
    docsUrl: "https://developer.tastytrade.com/",
    notes: "Session login against the Tastytrade API. Sandbox uses separate credentials.",
  },
  {
    id: "tradovate",
    name: "Tradovate",
    group: "Stocks / Futures",
    assets: ["futures"],
    testable: true,
    trading: true,
    envs: [
      { value: "practice", label: "Demo" },
      { value: "live", label: "Live" },
    ],
    fields: [
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
      { key: "apiKey", label: "App ID / device ID", secret: true, optional: true },
    ],
    docsUrl: "https://api.tradovate.com/",
    notes:
      "Futures routing venue, and the way US traders execute Dow, Nasdaq, S&P, gold and oil (MYM, MNQ, MES, MGC, MCL) - OANDA cannot offer those to US accounts. Also the API path used by NinjaTrader accounts cleared through Tradovate.",

  },
  {
    id: "ninjatrader",
    name: "NinjaTrader",
    group: "Stocks / Futures",
    assets: ["futures"],
    testable: false,
    trading: false,
    fields: [ACCOUNT],
    docsUrl: "https://developer.ninjatrader.com/",
    notes:
      "NinjaTrader has no public cloud REST API. Trades route through the desktop platform, so TradeMind sends signals and you execute in NT. If your account clears through Tradovate, connect Tradovate for direct routing.",
  },
  {
    id: "interactivebrokers",
    name: "Interactive Brokers",
    group: "Stocks / Futures",
    assets: ["stocks", "options", "futures", "forex"],
    testable: false,
    trading: false,
    fields: [ACCOUNT],
    docsUrl: "https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/",
    notes:
      "The other US route to index and gold futures alongside stocks and forex. IBKR requires the Client Portal Gateway running on your own machine, so cloud verification is not possible. Store your account ID for signal context.",
  },
  {
    id: "coinbase",
    name: "Coinbase (Advanced Trade)",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET, PASS],
    docsUrl: "https://docs.cdp.coinbase.com/advanced-trade/docs/welcome",
    notes:
      "Recommended crypto venue for US traders: API key, secret and passphrase. Read-only keys are enough to verify balances.",
  },
  {
    id: "binance",
    name: "Binance (non-US only)",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET],
    docsUrl: "https://developers.binance.com/docs/binance-spot-api-docs",
    notes:
      "Binance.com does not serve US residents, and Binance.US is a separate exchange with a smaller product set and different keys. If you are in the US, connect Coinbase Advanced Trade instead. HMAC key pair; restrict the key to your IP and disable withdrawals.",
  },

  {
    id: "bybit",
    name: "Bybit",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET],
    docsUrl: "https://bybit-exchange.github.io/docs/v5/intro",
    notes: "V5 unified account key pair.",
  },
  {
    id: "okx",
    name: "OKX",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET, PASS],
    docsUrl: "https://www.okx.com/docs-v5/en/",
    notes: "V5 API key, secret and passphrase.",
  },
  {
    id: "kucoin",
    name: "KuCoin",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET, PASS],
    docsUrl: "https://www.kucoin.com/docs/beginners/introduction",
    notes: "API v2 key with passphrase.",
  },
  {
    id: "bitget",
    name: "Bitget",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET, PASS],
    docsUrl: "https://www.bitget.com/api-doc/common/intro",
    notes: "V2 API key with passphrase.",
  },
  {
    id: "kraken",
    name: "Kraken",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET],
    docsUrl: "https://docs.kraken.com/rest/",
    notes: "API key and private key from Kraken security settings.",
  },
  {
    id: "gemini",
    name: "Gemini",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET],
    docsUrl: "https://docs.gemini.com/rest-api/",
    notes: "Primary or master API key pair.",
  },
  {
    id: "bitmex",
    name: "BitMEX",
    group: "Crypto",
    assets: ["crypto"],
    testable: true,
    trading: true,
    fields: [KEY, SECRET],
    docsUrl: "https://www.bitmex.com/app/apiOverview",
    notes: "API key pair with order or read permission.",
  },
];

export const BROKER_BY_ID: Record<string, BrokerDef> = Object.fromEntries(
  BROKERS.map((b) => [b.id, b]),
);

export const BROKER_GROUPS: Array<BrokerDef["group"]> = ["Forex / CFD", "Stocks / Futures", "Crypto"];

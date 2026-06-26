export type HelpArticle = {
  slug: string;
  title: string;
  category: string;
  description: string;
  // Plain paragraphs; render as <p>. Use "## " prefix for subheadings.
  body: string[];
};

export const HELP_CATEGORIES = [
  {
    id: "getting-started",
    title: "Getting started",
    description: "Sign up, onboard, and take your first coached trade.",
  },
  {
    id: "coaching",
    title: "AI coaching",
    description: "How the coaches grade setups and how to talk to them.",
  },
  {
    id: "brokers-data",
    title: "Brokers & data",
    description: "Connect a broker, import trades, and read your analytics.",
  },
  {
    id: "account-billing",
    title: "Account & billing",
    description: "Plans, payments, downgrades, and cancellations.",
  },
  {
    id: "privacy-security",
    title: "Privacy & security",
    description: "Data handling, exports, deletion, and account safety.",
  },
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "create-your-account",
    category: "getting-started",
    title: "Create your account",
    description: "Sign up with email or Google and finish onboarding in under two minutes.",
    body: [
      "Visit the sign-in page and choose either email + password or Google. Email signups require a working address - we send a confirmation link before your account is active.",
      "After confirming, you will be taken through a short onboarding flow: pick your trading style, choose a default AI coach, and (optionally) connect a broker.",
      "## Forgot your password?",
      "Use the 'reset password' link on the sign-in page. We email a one-time link valid for 60 minutes.",
    ],
  },
  {
    slug: "choosing-a-coach",
    category: "getting-started",
    title: "Choose the right AI coach",
    description: "Five coaching personalities, from disciplined Analyst to aggressive Beast.",
    body: [
      "TradeMind ships with five coaching personalities. Each one weighs setup quality, your track record, and risk differently - pick the voice that pushes you in the direction you actually need.",
      "You can switch coaches at any time from the Coaches tab or directly inside a chat thread. Your trade history and journal carry across coaches.",
    ],
  },
  {
    slug: "how-grading-works",
    category: "coaching",
    title: "How setup grading works",
    description: "What the AI is actually looking at when it scores your trade.",
    body: [
      "When you paste a chart or describe a setup, the coach scores it across structure, momentum, location, risk-reward, and fit with your personal stats.",
      "The grade is an opinion, not a guarantee. Take it as a second pair of eyes - a senior trader who never gets tilted and never gets bored of reading your charts.",
      "## What it does not do",
      "It does not place trades, move stops, or give regulated financial advice. Execution and risk stay with you and your broker.",
    ],
  },
  {
    slug: "voice-coach",
    category: "coaching",
    title: "Using the voice coach",
    description: "Talk to your coach hands-free while you watch the chart.",
    body: [
      "Open the Voice Coach from the side nav. Tap the mic and start talking - describe the setup, the news, what you are feeling. The coach responds in voice and the transcript saves to your chat history.",
      "Voice sessions count toward your daily AI quota the same way text chats do.",
    ],
  },
  {
    slug: "connect-a-broker",
    category: "brokers-data",
    title: "Connect a broker",
    description: "Import your trade history so the coach knows your real edge.",
    body: [
      "Go to Settings → Brokers and pick your broker. You will be guided through either an OAuth flow or a secure token paste, depending on the broker.",
      "Once connected, your closed trades sync into your journal automatically. The coach uses them to spot patterns - symbols you keep losing on, sessions where you tilt, setups where you are statistically strong.",
      "## Disconnecting",
      "You can revoke broker access at any time from Settings → Brokers. Existing imported trades stay in your journal until you delete them.",
    ],
  },
  {
    slug: "import-tradelocker",
    category: "brokers-data",
    title: "Import from TradeLocker",
    description: "One-time CSV import for TradeLocker accounts.",
    body: [
      "Export your trade history from TradeLocker as CSV, then upload it from Settings → Import. We map columns automatically; anything ambiguous you confirm manually before the import runs.",
      "Duplicates are detected by broker trade ID, so re-importing the same file is safe.",
    ],
  },
  {
    slug: "daily-ai-limits",
    category: "account-billing",
    title: "Daily AI usage limits",
    description: "Why the coach sometimes asks you to wait until tomorrow.",
    body: [
      "Every plan has a daily cap on AI coaching messages. The cap resets at 00:00 UTC. Voice sessions and text chats both count.",
      "If you hit the cap, upgrading takes effect immediately - your remaining requests jump to the new plan's allowance.",
    ],
  },
  {
    slug: "change-or-cancel-plan",
    category: "account-billing",
    title: "Change or cancel your plan",
    description: "Upgrade, downgrade, or end your subscription.",
    body: [
      "Open Settings → Billing. You can switch plans at any time. Upgrades take effect immediately and are pro-rated. Downgrades take effect at the end of your current billing period - you keep the higher tier until then.",
      "Cancelling stops the next renewal. You keep access until the period ends. We do not pro-rate refunds for the unused portion of a paid period.",
      "## Trial",
      "Cancelling during your 7-day trial means you are not charged. Your account stays active in read-only mode until you re-subscribe.",
    ],
  },
  {
    slug: "export-your-data",
    category: "privacy-security",
    title: "Export your data",
    description: "Download everything we store about you as JSON.",
    body: [
      "Open Settings → Privacy & Data and click 'Download my data'. You get a single JSON file containing your profile, chat threads, messages, broker connections, and AI usage.",
      "The export is generated on-demand - there is no waiting list and no email follow-up.",
    ],
  },
  {
    slug: "delete-your-account",
    category: "privacy-security",
    title: "Delete your account",
    description: "Permanently remove your account and all associated data.",
    body: [
      "Open Settings → Privacy & Data, click 'Delete my account', and type DELETE to confirm. Deletion is immediate and cascades through profiles, chat history, broker connections, and usage records.",
      "Account deletion cannot be reversed. Export your data first if you want a copy.",
    ],
  },
  {
    slug: "is-my-data-safe",
    category: "privacy-security",
    title: "How we protect your data",
    description: "Encryption, row-level security, and what we never store.",
    body: [
      "All traffic is TLS-encrypted. Database tables use row-level security so one user can never read another user's data, even if application code has a bug.",
      "We never store broker passwords. Broker access uses OAuth tokens or scoped API keys, stored encrypted at rest. You can revoke them at any time.",
    ],
  },
];

export function getArticleBySlug(slug: string) {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function getArticlesByCategory(categoryId: string) {
  return HELP_ARTICLES.filter((a) => a.category === categoryId);
}

import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy, TradeMind" },
      { name: "description", content: "How TradeMind collects, uses, and retains your data." },
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12 sm:py-20 text-sm leading-relaxed">
      <Link to="/" className="text-xs font-mono uppercase tracking-[0.2em] text-primary hover:underline">
        ← Back
      </Link>
      <h1 className="font-display text-4xl sm:text-5xl mt-6 mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-10">Last updated: June 23, 2026</p>

      <Section title="1. Who we are">
        TradeMind ("we", "us") provides an AI trading coach at trademindaicoach.com. This policy explains what
        personal data we collect, why, how long we keep it, and the rights you have over it.
      </Section>

      <Section title="2. Data we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Account data:</strong> email address, display name, password hash (managed by our auth provider).</li>
          <li><strong>Profile data:</strong> referral source, onboarding answers, broker connection status (you choose what to share).</li>
          <li><strong>Chat &amp; coaching:</strong> messages you send to the AI coach and the responses generated.</li>
          <li><strong>Trade journal:</strong> trade entries you create or import. <strong>Stored locally in your browser</strong> - not on our servers.</li>
          <li><strong>Broker credentials:</strong> when you sync TradeLocker, your password is used once per request and is <strong>never</strong> stored.</li>
          <li><strong>Usage data:</strong> daily AI request counts, server logs (IP, timestamp, request ID) for security and rate limiting.</li>
        </ul>
      </Section>

      <Section title="3. How we use it">
        <ul className="list-disc pl-5 space-y-2">
          <li>To provide the service: authenticate you, run the AI coach, sync your broker data.</li>
          <li>To enforce daily usage limits and prevent abuse.</li>
          <li>To improve the product (aggregated, non-identifying analytics).</li>
          <li>To respond to support requests.</li>
        </ul>
        <p className="mt-3">
          We do <strong>not</strong> sell your personal data. We do not use your trade data or chat history to train
          third-party AI models.
        </p>
      </Section>

      <Section title="4. Third parties we share with">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Hosting &amp; database:</strong> our managed cloud backend (stores account, profile, chat data).</li>
          <li><strong>AI provider:</strong> chat messages are sent to the AI inference provider that powers the coach. They process requests only and do not retain content for training.</li>
          <li><strong>Market data:</strong> public price data from Twelve Data and similar providers (no personal data shared).</li>
          <li><strong>Voice synthesis:</strong> ElevenLabs (only the text being spoken is sent - no account identifiers).</li>
        </ul>
      </Section>

      <Section title="5. How long we keep it">
        <ul className="list-disc pl-5 space-y-2">
          <li><strong>Account &amp; profile:</strong> for the life of your account.</li>
          <li><strong>Chat history:</strong> until you delete the thread or your account.</li>
          <li><strong>AI usage counters:</strong> 90 days, then auto-purged.</li>
          <li><strong>Server logs:</strong> 30 days.</li>
          <li><strong>After account deletion:</strong> everything is removed from production systems immediately. Encrypted backups roll off within 30 days.</li>
        </ul>
      </Section>

      <Section title="6. Your rights">
        <p>
          Under GDPR, UK GDPR, and CCPA you have the right to access, export, correct, and delete your personal data.
          You can exercise these rights directly from <Link to="/settings" className="text-primary underline">Settings → Privacy &amp; Data</Link>:
        </p>
        <ul className="list-disc pl-5 space-y-2 mt-3">
          <li><strong>Download all my data</strong> - exports your account, profile, chats, and usage as a JSON file.</li>
          <li><strong>Delete my account</strong> - permanently removes your account and all associated data.</li>
        </ul>
        <p className="mt-3">
          For anything else, email <a href="mailto:privacy@trademindaicoach.com" className="text-primary underline">privacy@trademindaicoach.com</a>.
        </p>
      </Section>

      <Section title="7. Cookies">
        We only use cookies and local storage that are strictly necessary to keep you signed in and to remember your
        UI preferences (time format, muted welcome voice, journal entries). We do not use advertising,
        cross-site tracking, or marketing-attribution cookies. See <Link to="/cookies" className="text-primary underline">Cookies</Link>.
      </Section>

      <Section title="8. Security">
        All traffic is encrypted in transit (HTTPS). Passwords are hashed by our auth provider. API endpoints are
        rate-limited per IP and origin-locked to our domain. Row-Level Security in the database ensures one user
        cannot read another user's data even if application code has a bug.
      </Section>

      <Section title="9. Changes">
        We will update this page when our practices change. Material changes will be announced in-app.
      </Section>

      <p className="text-xs text-muted-foreground mt-12">
        TradeMind is an educational tool. Nothing on the service is financial advice.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl sm:text-2xl mb-3">{title}</h2>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

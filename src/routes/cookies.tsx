import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Cookies, TradeMind" },
      { name: "description", content: "How TradeMind uses cookies and local storage." },
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12 sm:py-20 text-sm leading-relaxed">
      <Link to="/" className="text-xs font-mono uppercase tracking-[0.2em] text-primary hover:underline">← Back</Link>
      <h1 className="font-display text-4xl sm:text-5xl mt-6 mb-2">Cookies &amp; Local Storage</h1>
      <p className="text-muted-foreground mb-10">Last updated: June 23, 2026</p>

      <p className="text-muted-foreground mb-8">
        TradeMind only uses storage that is <strong>strictly necessary</strong> to run the app. We do not use
        advertising cookies, cross-site tracking, marketing pixels, or third-party analytics that profile you.
        Because every cookie/key listed below is essential, no consent banner is shown for them under GDPR
        Article 7. You can still wipe them at any time by clearing your browser's site data.
      </p>

      <Section title="Strictly necessary">
        <ul className="list-disc pl-5 space-y-3">
          <li>
            <strong>Auth session</strong> (<code>sb-*-auth-token</code>) - keeps you signed in. Cleared on sign-out
            or account deletion.
          </li>
          <li>
            <strong>UI preferences</strong> (<code>trademind.timeFormat</code>, <code>trademind.welcome-back.muted</code>) - remember your
            chosen time format and welcome-voice setting.
          </li>
          <li>
            <strong>Trade journal</strong> (<code>trademind.journal.trades.v1</code>) - your imported trades live in
            your browser only, never on our servers.
          </li>
          <li>
            <strong>Broker preferences</strong> (<code>trademind.tradelocker.creds.v1</code>) - non-secret broker
            connection prefs (email, server, account choice). <strong>Passwords are never stored.</strong>
          </li>
        </ul>
      </Section>

      <Section title="What we do not use">
        <ul className="list-disc pl-5 space-y-2">
          <li>Google Analytics, Meta Pixel, TikTok Pixel, or any ad-tech tracking.</li>
          <li>Cross-site tracking cookies.</li>
          <li>Fingerprinting or behavioural profiling.</li>
        </ul>
      </Section>

      <p className="text-xs text-muted-foreground mt-12">
        Questions? <a href="mailto:privacy@trademindaicoach.com" className="text-primary underline">privacy@trademindaicoach.com</a>
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

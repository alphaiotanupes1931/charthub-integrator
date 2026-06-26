import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service, TradeMind" },
      { name: "description", content: "Terms governing your use of TradeMind." },
      { name: "robots", content: "index, follow" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-6 py-12 sm:py-20 text-sm leading-relaxed">
      <Link to="/" className="text-xs font-mono uppercase tracking-[0.2em] text-primary hover:underline">← Back</Link>
      <h1 className="font-display text-4xl sm:text-5xl mt-6 mb-2">Terms of Service</h1>
      <p className="text-muted-foreground mb-10">Last updated: June 23, 2026</p>

      <Section title="1. What TradeMind is">
        TradeMind is an educational AI trading coach. It grades setups, journals trades, and explains market
        structure. It is a research and education tool - not a broker, not a financial advisor, not a fund manager.
      </Section>

      <Section title="2. Not financial advice">
        <p className="font-semibold text-foreground">
          Nothing produced by TradeMind is financial, investment, legal, or tax advice.
        </p>
        <p className="mt-2">
          AI-generated grades, commentary, and trade ideas are for educational and informational purposes only.
          Trading and investing involve substantial risk of loss. Past performance does not guarantee future results.
          You are solely responsible for your trading decisions and any losses that result from them. If you need
          financial advice, consult a licensed professional in your jurisdiction.
        </p>
      </Section>

      <Section title="3. Your account">
        You must be 18 or older. You are responsible for keeping your login credentials secure and for all activity
        on your account. We may suspend accounts that violate these terms or applicable law.
      </Section>

      <Section title="4. Acceptable use">
        <ul className="list-disc pl-5 space-y-2">
          <li>Do not abuse the AI endpoints (rate limits apply).</li>
          <li>Do not scrape, reverse-engineer, or resell the service.</li>
          <li>Do not use TradeMind to manipulate markets, defraud anyone, or break the law.</li>
        </ul>
      </Section>

      <Section title="5. Subscriptions and billing">
        Paid plans renew automatically until cancelled. You can cancel any time from Settings → Billing. Refunds are
        handled case-by-case; contact support.
      </Section>

      <Section title="6. Third-party brokers and data">
        Broker connections (e.g. TradeLocker) are operated by third parties under their own terms. TradeMind does not
        hold funds, place orders, or guarantee the accuracy of imported data.
      </Section>

      <Section title="7. Liability">
        To the maximum extent permitted by law, TradeMind is provided "as is" without warranties of any kind. We are
        not liable for trading losses, missed opportunities, or any indirect or consequential damages arising from
        your use of the service.
      </Section>

      <Section title="8. Privacy">
        Your data is handled according to our <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
      </Section>

      <Section title="9. Changes">
        We may update these terms. Continued use after changes means you accept the updated terms.
      </Section>

      <Section title="10. Contact">
        <a href="mailto:support@trademindaicoach.com" className="text-primary underline">support@trademindaicoach.com</a>
      </Section>
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

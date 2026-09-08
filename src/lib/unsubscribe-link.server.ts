// Server-only: mints the branded unsubscribe link that goes in the footer of
// every marketing email, so opting out happens on a TradeMind page instead of
// a generic hosted one.
export const SITE_URL = "https://www.trademindaicoach.com";

type Admin = { from: (t: string) => any };

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns a stable, still-valid unsubscribe token for this address, creating
 * one when none exists. Reusing the token keeps every email in the sequence
 * pointing at a link that still works.
 */
export async function unsubscribeToken(admin: Admin, email: string): Promise<string | null> {
  const addr = email.trim().toLowerCase();

  const { data: existing } = await admin
    .from("email_unsubscribe_tokens")
    .select("token")
    .ilike("email", addr)
    .is("used_at", null)
    .limit(1)
    .maybeSingle();
  if (existing?.token) return String(existing.token);

  const token = newToken();
  const { error } = await admin.from("email_unsubscribe_tokens").insert({ email: addr, token });
  if (error) {
    // Lost a race with a parallel send: take whatever token now exists.
    const { data: raced } = await admin
      .from("email_unsubscribe_tokens")
      .select("token")
      .ilike("email", addr)
      .is("used_at", null)
      .limit(1)
      .maybeSingle();
    return raced?.token ? String(raced.token) : null;
  }
  return token;
}

export function unsubscribeUrl(token: string): string {
  return `${SITE_URL}/unsubscribe?token=${token}`;
}

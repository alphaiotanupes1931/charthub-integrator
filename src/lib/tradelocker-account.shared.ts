/** Account type is independent of the API login environment and of balance. */
export function tradeLockerAccountType(account: {
  accountType?: unknown; type?: unknown; isDemo?: unknown;
}): "demo" | "live" | "unknown" {
  if (typeof account.isDemo === "boolean") return account.isDemo ? "demo" : "live";
  for (const raw of [account.accountType, account.type]) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (["demo", "practice", "paper"].includes(value)) return "demo";
    if (["live", "real"].includes(value)) return "live";
  }
  return "unknown";
}

export function tradeLockerAccountLabel(type: string): string {
  return type === "live" ? "Live account" : type === "demo" ? "Demo account" : "Account type unconfirmed";
}
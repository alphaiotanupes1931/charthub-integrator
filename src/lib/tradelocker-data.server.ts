import { tlBase, tlFetch, tlHeaders, type TLAccount, type TLEnv } from "./broker-tradelocker.server";
import { tlNumber, tlRecord, type TLPanel } from "./tradelocker-data.shared";

export type TLConfig = { positionsConfig?: TLPanel; ordersConfig?: TLPanel; accountDetailsConfig?: TLPanel };
export async function readTLAccount(env: TLEnv, token: string, account: TLAccount) {
  const base = tlBase(env);
  const headers = tlHeaders(token, account);
  const [config, state, details] = await Promise.all([
    tlFetch<{ d?: TLConfig }>(`${base}/trade/config`, { headers }, "Account configuration unavailable"),
    tlFetch<{ d?: { accountDetailsData?: unknown[] } }>(`${base}/trade/accounts/${account.id}/state`, { headers }, "Account balance unavailable"),
    tlFetch<{ d?: TLAccount[] }>(`${base}/trade/accounts`, { headers }, "Account type unavailable").catch(() => ({ d: undefined })),
  ]);
  const values = tlRecord(config.d?.accountDetailsConfig?.columns, state.d?.accountDetailsData);
  const detail = details.d?.find((a) => String(a.id) === String(account.id)) ?? (details.d?.length === 1 ? details.d[0] : undefined);
  return { config: config.d ?? {}, values, account: { ...account, ...detail }, balance: tlNumber(values.balance) ?? tlNumber(account.accountBalance) };
}
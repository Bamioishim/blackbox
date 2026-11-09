/**
 * Settlement sits behind one interface: settle(deal).
 * Design follows Kite Passport spending sessions (docs.gokite.ai/passport):
 * on close we open a one-off session whose total cap AND per-transaction cap both equal the
 * agreed amount, with a short expiry, so the rail itself refuses anything above the deal.
 *
 * MockKiteSettler is what runs today. It is labelled MOCK everywhere. No money moves.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { canonical, fmtAmount, randomHex, round6 } from "./canonical";

export type SettleInput = {
  dealId: string;
  item: string;
  quantity: number;
  unitPrice: number;
  total: number; // unitPrice * quantity, 6dp
  asset: "USDC";
  payee: string; // seller's receiving address/handle
  payer: string;
};

export type SessionIntent = {
  provider: "kite-passport";
  mode: "mock" | "kite-testnet" | "kite-mainnet";
  sessionId: string;
  dealId: string;
  taskSummary: string;
  asset: "USDC";
  maxAmountPerTx: string;
  maxTotalAmount: string;
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
  payee: string;
};

export type Delegation = { scheme: string; signer: string; signature: string; message: string };
export type PaymentAttempt = { label: string; amount: string; ok: boolean; code: string; ref?: string };

export type Settlement = {
  mode: "mock" | "kite-testnet" | "kite-mainnet";
  live: boolean; // true ONLY if a real payment settled on a real network
  label: string;
  session: SessionIntent;
  delegation: Delegation;
  payment: PaymentAttempt;
  enforcement: PaymentAttempt[];
};

export interface Settler {
  readonly mode: Settlement["mode"];
  settle(deal: SettleInput): Promise<Settlement>;
}

export const SESSION_TTL_SECONDS = 600;

/** Same rules Kite's backend enforces (error codes from docs.gokite.ai/reference/error-codes). */
export function checkAgainstSession(
  s: SessionIntent,
  spentSoFar: number,
  amount: number,
  now: Date,
): { ok: boolean; code: string } {
  if (now.getTime() > Date.parse(s.expiresAt)) return { ok: false, code: "session_expired" };
  if (amount > Number(s.maxAmountPerTx) + 1e-9) return { ok: false, code: "session_rule_exceeded" };
  if (spentSoFar + amount > Number(s.maxTotalAmount) + 1e-9) return { ok: false, code: "session_total_exceeded" };
  return { ok: true, code: "ok" };
}

export function buildSessionIntent(deal: SettleInput, mode: SessionIntent["mode"], now = new Date()): SessionIntent {
  const total = fmtAmount(deal.total);
  return {
    provider: "kite-passport",
    mode,
    sessionId: (mode === "mock" ? "mock_sess_" : "sess_") + randomHex(8),
    dealId: deal.dealId,
    taskSummary: `Pay ${total} USDC for ${deal.quantity} x ${deal.item} (Sealed deal ${deal.dealId}). One payment only.`,
    asset: "USDC",
    maxAmountPerTx: total,
    maxTotalAmount: total,
    ttlSeconds: SESSION_TTL_SECONDS,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    payee: deal.payee,
  };
}

export class MockKiteSettler implements Settler {
  readonly mode = "mock" as const;
  async settle(deal: SettleInput): Promise<Settlement> {
    const now = new Date();
    const session = buildSessionIntent(deal, "mock", now);
    // Ephemeral key standing in for the owner's passkey approval. MOCK: not a Kite passkey.
    const account = privateKeyToAccount(generatePrivateKey());
    const message = canonical(session);
    const signature = await account.signMessage({ message });
    const delegation: Delegation = {
      scheme: "MOCK: EIP-191 signature by a throwaway demo key (stands in for a Kite passkey approval)",
      signer: account.address,
      signature,
      message,
    };
    const total = deal.total;
    let spent = 0;
    const pay = checkAgainstSession(session, spent, total, now);
    if (pay.ok) spent = round6(spent + total);
    const payment: PaymentAttempt = {
      label: "Pay the agreed amount",
      amount: fmtAmount(total),
      ok: pay.ok,
      code: pay.ok ? "settled_mock" : pay.code,
      ref: pay.ok ? "mock_tx_" + randomHex(12) : undefined,
    };
    // Show the rail refusing anything beyond the deal.
    const over = round6(total + 0.01);
    const r1 = checkAgainstSession(session, 0, over, now);
    const r2 = checkAgainstSession(session, spent, 0.01, now);
    const enforcement: PaymentAttempt[] = [
      { label: "Try to pay 0.01 more than agreed", amount: fmtAmount(over), ok: r1.ok, code: r1.code },
      { label: "Try a second payment after settling", amount: fmtAmount(0.01), ok: r2.ok, code: r2.code },
    ];
    return {
      mode: "mock",
      live: false,
      label: "MOCK settlement. No money moved. Session, caps and checks mirror Kite Passport; the signature is from a throwaway demo key.",
      session,
      delegation,
      payment,
      enforcement,
    };
  }
}

export function getSettler(): Settler {
  // Kite adapter lives in settle-kite.ts (server-only) and is enabled only with SETTLE_MODE=kite.
  return new MockKiteSettler();
}

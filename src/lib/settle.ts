/**
 * Settlement sits behind one interface: settle(deal).
 *
 * Design follows Kite Passport spending sessions (docs.gokite.ai/passport):
 *  - Before the haggle, the owner sets a SPENDING LIMIT (budget). It becomes the session's
 *    payment_policy.max_total_amount and max_amount_per_tx, i.e. the delegation the owner approves
 *    with their passkey. Kite's backend refuses any payment past it (session_total_exceeded).
 *  - On close, Blackbox pays exactly the agreed total, once. Anything else is refused by the deal rule
 *    (over_agreed_total, deal_already_settled) even if it would fit inside the budget.
 *
 * MockKiteSettler is what runs today. Every output says SIMULATED: no real funds move, the ref is not
 * a transaction, and the delegation is signed by a throwaway key, not a Kite passkey.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { canonical, fmtAmount, randomHex, round6, sha256Hex } from "./canonical";

export const SIMULATED_LABEL = "SIMULATED — no real funds moved";

export type BudgetReveal = { kind: "budget"; dealId: string; budget: string; salt: string };
export type BudgetCommitment = { dealId: string; commitment: string };

/** commitment = sha256(canonical({kind:"budget", dealId, budget, salt})), budget as a 6-decimal string. */
export function commitBudget(dealId: string, budget: number, salt = randomHex(32)) {
  const reveal: BudgetReveal = { kind: "budget", dealId, budget: fmtAmount(budget), salt };
  return { commitment: { dealId, commitment: sha256Hex(canonical(reveal)) } as BudgetCommitment, reveal };
}
export function checkBudgetReveal(c: BudgetCommitment, r: BudgetReveal): boolean {
  return !!c && !!r && c.dealId === r.dealId && r.kind === "budget" && /^\d+\.\d{6}$/.test(r.budget) && sha256Hex(canonical(r)) === c.commitment;
}

/** The mandate the owner sets before the haggle: one Kite Passport spending session capped at their budget. */
export type Mandate = { sessionId: string; createdAt: string; ttlSeconds: number; budget: number; budgetReveal: BudgetReveal };

export type SettleInput = {
  dealId: string;
  item: string;
  quantity: number;
  unitPrice: number;
  total: number; // unitPrice * quantity, 6dp
  asset: "USDC";
  payee: string;
  payer: string;
  /** User-set spending limit. When absent (old receipts), the session cap is the deal total. */
  mandate?: Mandate;
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
  /** "user-budget": caps come from the owner's spending limit. Absent on older receipts (caps = deal total). */
  capSource?: "user-budget" | "deal-total";
  ttlSeconds: number;
  createdAt: string;
  expiresAt: string;
  payee: string;
};

export type Delegation = { scheme: string; signer: string; signature: string; message: string };
export type PaymentAttempt = { label: string; amount: string; ok: boolean; code: string; ref?: string; rule?: string };

export type Settlement = {
  mode: "mock" | "kite-testnet" | "kite-mainnet";
  live: boolean; // true ONLY if a real payment settled on a real network
  simulated?: boolean; // true whenever no real funds moved
  label: string;
  fallback?: { from: string; reason: string };
  session: SessionIntent;
  delegation: Delegation;
  payment: PaymentAttempt;
  enforcement: PaymentAttempt[];
  budget?: { limit: string; reveal: BudgetReveal; withinLimit: boolean };
};

export interface Settler {
  readonly mode: Settlement["mode"];
  settle(deal: SettleInput): Promise<Settlement>;
}

export const SESSION_TTL_SECONDS = 900;

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

/** Blackbox's own rule on top of the session: pay exactly the agreed total, once. */
export function checkAgainstDeal(agreedTotal: number, paidSoFar: number, amount: number): { ok: boolean; code: string } {
  if (paidSoFar > 0) return { ok: false, code: "deal_already_settled" };
  if (Math.abs(amount - agreedTotal) > 1e-9) return { ok: false, code: amount > agreedTotal ? "over_agreed_total" : "under_agreed_total" };
  return { ok: true, code: "ok" };
}

/**
 * The exact delegation JSON the owner approves in Kite Passport for this budget
 * (`kpass session create --separate --delegation '<this>'`). Caps are the user's spending limit.
 */
export function kiteDelegation(dealId: string, item: string, budget: number, ttlSeconds = SESSION_TTL_SECONDS) {
  const cap = fmtAmount(budget);
  return {
    task: { summary: `Pay one seller for ${item} agreed in Blackbox deal ${dealId}, up to ${cap} USDC.` },
    payment_policy: { currency: "USD", max_amount_per_tx: cap, max_total_amount: cap, ttl_seconds: ttlSeconds },
  };
}

export function buildSessionIntent(deal: SettleInput, mode: SessionIntent["mode"], now = new Date()): SessionIntent {
  const total = fmtAmount(deal.total);
  const m = deal.mandate;
  const createdAt = m ? m.createdAt : now.toISOString();
  const ttl = m ? m.ttlSeconds : SESSION_TTL_SECONDS;
  const cap = m ? fmtAmount(m.budget) : total;
  return {
    provider: "kite-passport",
    mode,
    sessionId: m ? m.sessionId : (mode === "mock" ? "sim_sess_" : "sess_") + randomHex(8),
    dealId: deal.dealId,
    taskSummary: m
      ? `Pay for ${deal.quantity} x ${deal.item} (Blackbox deal ${deal.dealId}). Spending limit set by the owner: ${cap} USDC.`
      : `Pay ${total} USDC for ${deal.quantity} x ${deal.item} (Blackbox deal ${deal.dealId}). One payment only.`,
    asset: "USDC",
    maxAmountPerTx: cap,
    maxTotalAmount: cap,
    capSource: m ? "user-budget" : "deal-total",
    ttlSeconds: ttl,
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + ttl * 1000).toISOString(),
    payee: deal.payee,
  };
}

export class MockKiteSettler implements Settler {
  readonly mode = "mock" as const;
  async settle(deal: SettleInput, fallback?: Settlement["fallback"]): Promise<Settlement> {
    const now = new Date();
    const session = buildSessionIntent(deal, "mock", now);
    // Ephemeral key standing in for the owner's passkey approval. SIMULATED: not a Kite passkey.
    const account = privateKeyToAccount(generatePrivateKey());
    const message = canonical(session);
    const signature = await account.signMessage({ message });
    const delegation: Delegation = {
      scheme: "SIMULATED: EIP-191 signature by a throwaway demo key (stands in for the owner's Kite passkey approval)",
      signer: account.address,
      signature,
      message,
    };
    const total = deal.total;
    const cap = Number(session.maxTotalAmount);
    let spent = 0;
    const s1 = checkAgainstSession(session, spent, total, now);
    const d1 = checkAgainstDeal(total, spent, total);
    const ok = s1.ok && d1.ok;
    if (ok) spent = round6(spent + total);
    const payment: PaymentAttempt = {
      label: "Pay the agreed amount",
      amount: fmtAmount(total),
      ok,
      code: ok ? "simulated_no_funds_moved" : !s1.ok ? s1.code : d1.code,
      rule: ok ? undefined : !s1.ok ? (deal.mandate ? "over your spending limit" : "session cap") : "deal rule",
      ref: ok ? "sim_" + randomHex(12) : undefined,
    };
    // Show the rail refusing anything beyond the deal and beyond the owner's limit.
    const over = round6(total + 0.01);
    const a1s = checkAgainstSession(session, 0, over, now);
    const a1 = a1s.ok ? checkAgainstDeal(total, 0, over) : a1s;
    const a2s = checkAgainstSession(session, spent, 0.01, now);
    const a2 = deal.mandate ? checkAgainstDeal(total, spent, 0.01) : a2s;
    const enforcement: PaymentAttempt[] = [
      { label: "Try to pay 0.01 more than agreed", amount: fmtAmount(over), ok: a1.ok, code: a1.code, rule: a1s.ok ? "deal rule" : "session cap" },
      { label: "Try a second payment after settling", amount: fmtAmount(0.01), ok: a2.ok, code: a2.code, rule: deal.mandate ? "deal rule" : "session cap" },
    ];
    if (deal.mandate) {
      const past = round6(cap - spent + 0.01);
      const a3 = checkAgainstSession(session, spent, past, now);
      enforcement.push({ label: "Try to spend past your spending limit", amount: fmtAmount(past), ok: a3.ok, code: a3.code, rule: "Kite session cap = your limit" });
    }
    const why = fallback ? ` Fallback: the Kite payment didn't go through (${fallback.reason}).` : "";
    return {
      mode: "mock",
      live: false,
      simulated: true,
      label: `${SIMULATED_LABEL}.${why} Session, caps and refusal codes mirror Kite Passport; the signature is from a throwaway demo key; the ref is not a transaction.`,
      ...(fallback ? { fallback } : {}),
      session,
      delegation,
      payment,
      enforcement,
      ...(deal.mandate ? { budget: { limit: fmtAmount(deal.mandate.budget), reveal: deal.mandate.budgetReveal, withinLimit: total <= deal.mandate.budget + 1e-9 } } : {}),
    };
  }
}

/** True when no real funds moved, for any receipt old or new. */
export function isSimulated(s: { mode?: string; live?: boolean } | null | undefined): boolean {
  return !s || s.live !== true || s.mode === "mock";
}

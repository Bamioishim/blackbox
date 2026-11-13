import type { LogEntry } from "./chain";
import type { Commitment, Reveal } from "./commit";
import type { Settlement } from "./settle";
import type { AnchorRecord } from "./anchor";
import type { AgentIdentity, AgentOwner } from "./identity";

export type DealTerms = {
  item: string;
  quantity: number;
  asset: "USDC";
  referencePrice: number;
  maxRounds: number;
  attackMode: boolean;
};

export type Receipt = {
  version: "blackbox/1";
  dealId: string;
  createdAt: string;
  model: string;
  terms: DealTerms;
  referee: { hash: string; files: string[] };
  commitments: Commitment[];
  reveals: Reveal[];
  outcome: { status: "closed" | "no_deal"; unitPrice: number | null; total: number | null; round: number | null };
  log: LogEntry[];
  finalHash: string;
  settlement: Settlement | null;
  anchor: AnchorRecord;
  /** Who was at the table (newer receipts). */
  identity?: { owner: AgentOwner; counterparty?: AgentOwner; agents: AgentIdentity[] };
  /** The owner's spending limit (newer receipts). Committed in the log at deal open, revealed at settlement. */
  budget?: { limit: string; commitment: string; sessionId: string };
  /**
   * Real on-chain payment for a deal that requested one (settlement mode kite-mainnet).
   * Recorded after the sealed log closed, so it is not part of the hash chain; the verifier
   * checks it against the sealed payment request and re-reads it from Solana mainnet.
   */
  onchainPayment?: OnchainPayment;
  /** Set only on the deliberately tampered example shipped in public/deals. */
  example?: { tampered: true; note: string };
};

/** Accepted offers grouped by round, read straight from the log. */
export function roundsFromLog(log: LogEntry[]) {
  const rounds = new Map<number, { round: number; buyer: { price: number; quantity: number; round: number } | null; seller: { price: number; quantity: number; round: number } | null }>();
  for (const e of log) {
    if (e.kind === "round.closed") {
      const r = Number(e.payload.round);
      if (!rounds.has(r)) rounds.set(r, { round: r, buyer: null, seller: null });
    }
  }
  for (const e of log) {
    if (e.kind === "offer.accepted") {
      const p = e.payload as { side: "buyer" | "seller"; price: number; quantity: number; round: number };
      const r = rounds.get(p.round) ?? { round: p.round, buyer: null, seller: null };
      r[p.side] = { price: p.price, quantity: p.quantity, round: p.round };
      rounds.set(p.round, r);
    }
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round);
}

export type OnchainPayment = {
  chain: "solana-mainnet";
  asset: "USDC";
  mint: string;
  amount: string; // 6dp string, equals the deal total
  amountAtomic: string;
  recipient: string;
  sender?: string;
  signature: string;
  explorerUrl: string;
  kiteRequestId?: string;
  slot?: number;
  blockTime?: number;
  verifiedAt: string;
};

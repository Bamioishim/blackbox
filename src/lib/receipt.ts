import type { LogEntry } from "./chain";
import type { Commitment, Reveal } from "./commit";
import type { Settlement } from "./settle";
import type { AnchorRecord } from "./anchor";

export type DealTerms = {
  item: string;
  quantity: number;
  asset: "USDC";
  referencePrice: number;
  maxRounds: number;
  attackMode: boolean;
};

export type Receipt = {
  version: "sealed/1";
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

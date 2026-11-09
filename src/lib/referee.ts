/**
 * The referee. Deterministic code, no model, no network, no clock, no randomness.
 * Same inputs always give the same outcome, so anyone can re-run it on a recorded log.
 * This file (plus schema.ts) is hashed at build time; the hash is shown in the UI and README.
 *
 * Rules:
 *  - Each round both sides submit one sealed offer at the same time.
 *  - An offer must pass parseOffer (exact keys price/quantity/round). Otherwise it is dropped.
 *  - No moving backwards: the buyer's bid can't go down, the seller's ask can't go up.
 *  - When bid >= ask the deal closes at the midpoint, rounded to 6 decimals.
 *  - If maxRounds pass without crossing, there is no deal.
 */
import { parseOffer, type Offer } from "./schema";

export type Side = "buyer" | "seller";
export type Terms = { quantity: number; maxRounds: number };

export type RefereeState = {
  round: number; // current round, 1-based
  bid: number | null;
  ask: number | null;
  status: "open" | "closed" | "no_deal";
  price: number | null;
  closedRound: number | null;
};

export type Verdict =
  | { side: Side; accepted: true; offer: Offer }
  | { side: Side; accepted: false; reason: string; preview: string };

export function initialState(): RefereeState {
  return { round: 1, bid: null, ask: null, status: "open", price: null, closedRound: null };
}

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Check one raw submission against schema and the no-going-backwards rule. Pure. */
export function judge(state: RefereeState, terms: Terms, side: Side, raw: unknown): Verdict {
  const parsed = parseOffer(raw, { quantity: terms.quantity, round: state.round });
  if (!parsed.ok) return { side, accepted: false, reason: parsed.reason, preview: parsed.preview };
  const p = parsed.offer.price;
  if (side === "buyer" && state.bid !== null && p < state.bid) {
    return { side, accepted: false, reason: "rejected: buyer bid moved backwards", preview: String(p) };
  }
  if (side === "seller" && state.ask !== null && p > state.ask) {
    return { side, accepted: false, reason: "rejected: seller ask moved backwards", preview: String(p) };
  }
  return { side, accepted: true, offer: parsed.offer };
}

/** Close a round given the accepted offers (either may be missing). Pure. */
export function closeRound(
  state: RefereeState,
  terms: Terms,
  buyer: Offer | null,
  seller: Offer | null,
): RefereeState {
  if (state.status !== "open") return state;
  const bid = buyer ? buyer.price : state.bid;
  const ask = seller ? seller.price : state.ask;
  if (bid !== null && ask !== null && bid >= ask) {
    return { round: state.round, bid, ask, status: "closed", price: r6((bid + ask) / 2), closedRound: state.round };
  }
  if (state.round >= terms.maxRounds) {
    return { round: state.round, bid, ask, status: "no_deal", price: null, closedRound: null };
  }
  return { round: state.round + 1, bid, ask, status: "open", price: null, closedRound: null };
}

/** Re-run the referee on a list of accepted offers per round. Used by the public verifier. */
export function replay(
  terms: Terms,
  rounds: { round: number; buyer: Offer | null; seller: Offer | null }[],
): RefereeState {
  let s = initialState();
  for (const r of [...rounds].sort((a, b) => a.round - b.round)) {
    if (s.status !== "open") break;
    if (r.round !== s.round) throw new Error(`replay: expected round ${s.round}, got ${r.round}`);
    s = closeRound(s, terms, r.buyer, r.seller);
  }
  return s;
}

import { canonical, sha256Hex, fmtAmount, randomHex } from "./canonical";
import type { Side } from "./referee";

export type Commitment = { side: Side; dealId: string; commitment: string };
export type Reveal = { side: Side; dealId: string; limit: string; salt: string };

/** commitment = sha256(canonical({side, dealId, limit, salt})), limit as a fixed 6-decimal string */
export function commitLimit(side: Side, dealId: string, limit: number, salt = randomHex(32)) {
  const reveal: Reveal = { side, dealId, limit: fmtAmount(limit), salt };
  const commitment = sha256Hex(canonical(reveal));
  return { commitment: { side, dealId, commitment } as Commitment, reveal };
}

export function checkReveal(c: Commitment, r: Reveal): boolean {
  if (c.side !== r.side || c.dealId !== r.dealId) return false;
  if (!/^\d+\.\d{6}$/.test(r.limit)) return false;
  return sha256Hex(canonical(r)) === c.commitment;
}

/** Buyer limit is a ceiling, seller limit is a floor. The price must sit inside both. */
export function priceWithinLimits(price: number, buyer: Reveal, seller: Reveal): { buyerOk: boolean; sellerOk: boolean } {
  return { buyerOk: price <= Number(buyer.limit), sellerOk: price >= Number(seller.limit) };
}

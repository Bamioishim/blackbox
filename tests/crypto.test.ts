import { describe, it, expect } from "vitest";
import { commitLimit, checkReveal, priceWithinLimits } from "@/lib/commit";
import { HashChain, verifyChain, sealContent, entryHash } from "@/lib/chain";
import { canonical } from "@/lib/canonical";

describe("commit-reveal", () => {
  it("a correct reveal matches", () => {
    const { commitment, reveal } = commitLimit("buyer", "deal_1", 0.92);
    expect(checkReveal(commitment, reveal)).toBe(true);
  });
  it("a changed limit, salt, side or deal fails", () => {
    const { commitment, reveal } = commitLimit("buyer", "deal_1", 0.92);
    expect(checkReveal(commitment, { ...reveal, limit: "0.930000" })).toBe(false);
    expect(checkReveal(commitment, { ...reveal, salt: "00" })).toBe(false);
    expect(checkReveal(commitment, { ...reveal, side: "seller" })).toBe(false);
    expect(checkReveal(commitment, { ...reveal, dealId: "deal_2" })).toBe(false);
  });
  it("same limit, different salts give different commitments", () => {
    expect(commitLimit("buyer", "d", 1).commitment.commitment).not.toBe(commitLimit("buyer", "d", 1).commitment.commitment);
  });
  it("price inside both limits", () => {
    const b = commitLimit("buyer", "d", 0.92).reveal;
    const s = commitLimit("seller", "d", 0.88).reveal;
    expect(priceWithinLimits(0.9, b, s)).toEqual({ buyerOk: true, sellerOk: true });
    expect(priceWithinLimits(0.93, b, s).buyerOk).toBe(false);
    expect(priceWithinLimits(0.87, b, s).sellerOk).toBe(false);
  });
});

describe("hash chain", () => {
  function build() {
    let t = 0;
    const c = new HashChain(() => new Date(1_700_000_000_000 + t++ * 1000).toISOString());
    c.append("deal.open", "system", { a: 1 });
    c.append("offer.accepted", "referee", { side: "buyer", price: 0.9, quantity: 500, round: 1 });
    c.append("deal.closed", "referee", { unitPrice: 0.9 });
    return c;
  }
  it("verifies an untouched chain", () => {
    expect(verifyChain(build().entries).ok).toBe(true);
  });
  it("detects an edited payload at the right index", () => {
    const e = structuredClone(build().entries);
    (e[1].payload as { price: number }).price = 0.95;
    const r = verifyChain(e);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(1);
  });
  it("detects a deleted or reordered entry", () => {
    const e = structuredClone(build().entries);
    expect(verifyChain([e[0], e[2]]).ok).toBe(false);
    expect(verifyChain([e[1], e[0], e[2]]).ok).toBe(false);
  });
  it("detects a recomputed hash that breaks the next link", () => {
    const c = build();
    const e = structuredClone(c.entries);
    (e[1].payload as { price: number }).price = 0.95;
    // attacker recomputes entry 1's hash, but entry 2 still points at the old one
    e[1].hash = entryHash(e[1]);
    const r = verifyChain(e);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });
  it("canonical JSON ignores key order", () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonical({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
  it("sealed content needs the salt", () => {
    expect(sealContent("ceiling 0.92", "s1")).not.toBe(sealContent("ceiling 0.92", "s2"));
  });
});

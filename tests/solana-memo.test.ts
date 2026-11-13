import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { anchorMemo, parseAnchorMemo, checkParsedMemo, memosFromParsedTx, BLACKBOX_ANCHOR_SOLANA } from "@/lib/solana-memo";
import { verifyReceipt } from "@/lib/verify";

const DEAL = "deal_74b9a05fe8f4";
const HASH = "2cb98d1cb3a02f18b00b011d5ffc0fa80de1da7224bb4b76a01d91809705c1a1";
const SIG = "3jFUTFv1NJBQgLscRc91qMvUv3kXpkeW7Ni5RPUALZXWivHfeRN6w5XXgwPFP225oGJA9eLaGUTAYN5q5MXTEBvy";
const fixture = JSON.parse(readFileSync("tests/fixtures/solana-memo-deal74.json", "utf8"));

describe("solana memo anchor", () => {
  it("formats and parses blackbox:<dealId>:<finalHash>", () => {
    const memo = anchorMemo(DEAL, HASH);
    expect(memo).toBe(`blackbox:${DEAL}:${HASH}`);
    expect(parseAnchorMemo(memo)).toEqual({ dealId: DEAL, finalHash: HASH });
    expect(anchorMemo(DEAL, "0x" + HASH.toUpperCase())).toBe(memo);
    expect(parseAnchorMemo("not a memo")).toBeNull();
  });

  it("accepts the recorded mainnet memo transaction", () => {
    expect(memosFromParsedTx(fixture)).toContain(`blackbox:${DEAL}:${HASH}`);
    const check = checkParsedMemo(fixture, { signature: SIG, dealId: DEAL, finalHash: HASH, writer: BLACKBOX_ANCHOR_SOLANA });
    expect(check.ok).toBe(true);
    expect(check.writer).toBe(BLACKBOX_ANCHOR_SOLANA);
    expect(check.slot).toBe(468776619);
  });

  it("fails if the hash in the memo is changed", () => {
    const check = checkParsedMemo(fixture, { signature: SIG, dealId: DEAL, finalHash: "f".repeat(64), writer: BLACKBOX_ANCHOR_SOLANA });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/does not match/i);
  });

  it("fails if the writer is not the published anchor wallet", () => {
    const check = checkParsedMemo(fixture, { signature: SIG, dealId: DEAL, finalHash: HASH, writer: "11111111111111111111111111111111" });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/not signed by the Blackbox anchor wallet/i);
  });
});

describe("published 0.86 USDC receipt", () => {
  it("verifies with no failed checks and an anchored final hash", async () => {
    const r = JSON.parse(readFileSync("public/deals/deal_74b9a05fe8f4.json", "utf8"));
    expect(r.dealId).toBe(DEAL);
    expect(r.finalHash).toBe(HASH);
    expect(r.anchor.status).toBe("anchored");
    expect(r.anchor.txHash).toBe(SIG);
    expect(r.onchainPayment?.signature).toBe("EirLVt2nyUbXXJRXMgRgKWMZX2krjzMxaZHPdbkMwgwSE145ssrHmDZaJxVMA2YeTtz8y1qKSsKCfvYbrzsdDWk");
    const checks = await verifyReceipt(r);
    expect(checks.filter((c) => c.ok === false)).toEqual([]);
    const anchor = checks.find((c) => c.id === "anchor")!;
    expect(anchor.ok).toBe(true);
  });
});

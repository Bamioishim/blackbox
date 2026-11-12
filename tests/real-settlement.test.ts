import { describe, it, expect } from "vitest";
import { isSimulated, MockKiteSettler, type SettleInput } from "@/lib/settle";
import { KITE_SOLANA_USDC_SETTLEMENT, REAL_SETTLEMENT_LABEL, USDC_MINT_SOLANA, solscanTxUrl } from "@/lib/real-settlement";

const SIG = "3jHaiNfAZA2phuiHpbbxm933aMxDsiYw9946ZEqvXtyzUMb9T2sHRq47upvyrgetNrr8MsK1ABUJ5Y4vLgrLM2pM";

describe("recorded real Kite Passport settlement", () => {
  it("is labelled as a real Solana mainnet settlement and never as a mock", () => {
    const s = KITE_SOLANA_USDC_SETTLEMENT;
    expect(s.label).toBe("Real settlement (Kite Passport, Solana mainnet)");
    expect(s.label).toBe(REAL_SETTLEMENT_LABEL);
    expect(s.live).toBe(true);
    expect(s.simulated).toBe(false);
    expect(s.mode).toBe("kite-mainnet");
    expect(s.chain).toBe("solana-mainnet");
    expect(isSimulated(s)).toBe(false);
  });

  it("matches the verified on-chain transfer", () => {
    const s = KITE_SOLANA_USDC_SETTLEMENT;
    expect(s.amount).toBe("1");
    expect(s.amountAtomic).toBe("1000000");
    expect(s.decimals).toBe(6);
    expect(s.mint).toBe(USDC_MINT_SOLANA);
    expect(s.mint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(s.from).toBe("ABVbrFkJoTEtBHvh7AiSBH11HLo5XbwSU9vJoUajZahN");
    expect(s.to).toBe("BYwZAHbD38RvEihmJgy7E95CMKJ3mLXy3tEEs48cPaQx");
    expect(s.signature).toBe(SIG);
    expect(s.explorerUrl).toBe(`https://solscan.io/tx/${SIG}`);
    expect(solscanTxUrl(s.signature)).toBe(s.explorerUrl);
    expect(s.kiteRequestId).toBe("wallet_send_req_01a1d1bc-ec7d-7cce-9c86-f7ec03979c63");
    expect(s.slot).toBe(468681920);
    expect(s.blockTime).toBe(1794520204);
    expect(s.settledAtWat).toBe("2026-11-12 22:50:04 WAT");
    expect(s.settledAtIso).toBe("2026-11-12T22:50:04+01:00");
  });

  it("does not change mock settle(deal) into a live payment", async () => {
    const deal: SettleInput = { dealId: "deal_test01", item: "X tokens", quantity: 500, unitPrice: 0.9, total: 450, asset: "USDC", payee: "seller", payer: "buyer" };
    const mock = await new MockKiteSettler().settle(deal);
    expect(mock.live).toBe(false);
    expect(isSimulated(mock)).toBe(true);
    expect(mock.label).toContain("SIMULATED — no real funds moved");
    expect(mock.payment.ref ?? "").not.toBe(SIG);
  });
});

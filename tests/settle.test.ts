import { describe, it, expect } from "vitest";
import { MockKiteSettler, commitBudget, checkBudgetReveal, kiteDelegation, SIMULATED_LABEL, isSimulated, type SettleInput } from "@/lib/settle";

const base: SettleInput = { dealId: "deal_test01", item: "X tokens", quantity: 500, unitPrice: 0.9, total: 450, asset: "USDC", payee: "seller", payer: "buyer" };
const mandate = (budget: number) => { const b = commitBudget(base.dealId, budget); return { sessionId: "sim_sess_x", createdAt: new Date().toISOString(), ttlSeconds: 900, budget, budgetReveal: b.reveal }; };

describe("spending limit and simulated settlement", () => {
  it("refuses to pay a deal total above the user's spending limit", async () => {
    const s = await new MockKiteSettler().settle({ ...base, mandate: mandate(400) });
    expect(s.payment.ok).toBe(false);
    expect(s.payment.code).toBe("session_rule_exceeded");
    expect(s.payment.ref).toBeUndefined();
    expect(s.budget?.withinLimit).toBe(false);
  });
  it("pays inside the limit, refuses more than agreed, a second payment, and spending past the limit", async () => {
    const s = await new MockKiteSettler().settle({ ...base, mandate: mandate(500) });
    expect(s.payment.ok).toBe(true);
    expect(s.session.maxTotalAmount).toBe("500.000000");
    expect(s.enforcement.map((e) => [e.ok, e.code])).toEqual([[false, "over_agreed_total"], [false, "deal_already_settled"], [false, "session_total_exceeded"]]);
  });
  it("labels every mock settlement SIMULATED and never as a transaction", async () => {
    const s = await new MockKiteSettler().settle(base, { from: "kite-mainnet", reason: "awaiting_passkey_approval" });
    expect(s.live).toBe(false);
    expect(isSimulated(s)).toBe(true);
    expect(s.label.startsWith(SIMULATED_LABEL)).toBe(true);
    expect(s.label).toContain("Fallback");
    expect(s.fallback?.reason).toBe("awaiting_passkey_approval");
    expect(s.payment.ref).not.toMatch(/^0x/);
  });
  it("budget commitment round-trips and detects a changed limit", () => {
    const b = commitBudget("deal_a", 475);
    expect(checkBudgetReveal(b.commitment, b.reveal)).toBe(true);
    expect(checkBudgetReveal(b.commitment, { ...b.reveal, budget: "999.000000" })).toBe(false);
  });
  it("wires the limit into the Kite Passport delegation caps", () => {
    const d = kiteDelegation("deal_a", "X tokens", 475);
    expect(d.payment_policy).toEqual({ currency: "USD", max_amount_per_tx: "475.000000", max_total_amount: "475.000000", ttl_seconds: 900 });
  });
});

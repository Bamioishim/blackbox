import { describe, it, expect, afterEach } from "vitest";
import { mintAgent, KITE_AGENTS, KITE_OWNER } from "@/lib/identity";

// Throwaway key: its address is NOT the registered one, so it must never be reported as bound.
const WRONG = "0x" + "11".repeat(32);

describe("Kite agent identity", () => {
  afterEach(() => { delete process.env.BLACKBOX_BUYER_AGENT_KEY; });

  it("Kite-owned seats carry the registered DID; without the bound key they say unbound", () => {
    const a = mintAgent("buyer", KITE_OWNER);
    expect(a.identity.kiteAgent?.did).toBe(KITE_AGENTS.buyer.did);
    expect(a.identity.kiteAgent?.agentId).toBe(KITE_AGENTS.buyer.agentId);
    expect(a.identity.binding.status).toBe("unbound");
  });

  it("a held key that is not the registered runtime key is ignored, never claimed as bound", () => {
    process.env.BLACKBOX_BUYER_AGENT_KEY = WRONG;
    const a = mintAgent("buyer", KITE_OWNER);
    expect(a.identity.binding.status).toBe("unbound");
    expect(a.identity.runtimeKey.toLowerCase()).not.toBe(KITE_AGENTS.buyer.runtimeKey.toLowerCase());
  });

  it("non-Kite owners get no Kite agent", () => {
    const a = mintAgent("seller", { provider: "blackbox-account", account: "u1", wallet: { evm: "", solana: "" }, backend: "blackbox" });
    expect(a.identity.kiteAgent).toBeUndefined();
    expect(a.identity.binding.status).toBe("unbound");
  });
});

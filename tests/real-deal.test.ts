import { describe, it, expect } from "vitest";
import { negotiate } from "@/lib/negotiate";
import { verifyReceipt } from "@/lib/verify";
import { KitePendingSettler, isRealPaymentRequest } from "@/lib/settle";
import { checkParsedTransfer, isSolanaAddress, usdcToAtomic, atomicToUsdc, verifyUsdcTransfer, solanaRpcEndpoints, SAME_ORIGIN_SOLANA_RPC, proxyRpcRequestError, forwardSolanaRpc, rpcWithFallback } from "@/lib/solana-verify";
import { USDC_MINT_SOLANA } from "@/lib/real-settlement";

const PAYOUT = "BYwZAHbD38RvEihmJgy7E95CMKJ3mLXy3tEEs48cPaQx";
const SENDER = "ABVbrFkJoTEtBHvh7AiSBH11HLo5XbwSU9vJoUajZahN";
const SIG = "3jHaiNfAZA2phuiHpbbxm933aMxDsiYw9946ZEqvXtyzUMb9T2sHRq47upvyrgetNrr8MsK1ABUJ5Y4vLgrLM2pM";

function tx(received: string, opts: { err?: unknown; blockTime?: number; mint?: string } = {}) {
  const mint = opts.mint ?? USDC_MINT_SOLANA;
  return {
    slot: 1, blockTime: opts.blockTime ?? 2_000_000_000,
    meta: {
      err: opts.err ?? null,
      preTokenBalances: [
        { accountIndex: 1, mint, owner: SENDER, uiTokenAmount: { amount: "1344717" } },
        { accountIndex: 2, mint, owner: PAYOUT, uiTokenAmount: { amount: "1000000" } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint, owner: SENDER, uiTokenAmount: { amount: String(1344717 - Number(received)) } },
        { accountIndex: 2, mint, owner: PAYOUT, uiTokenAmount: { amount: String(1000000 + Number(received)) } },
      ],
    },
  };
}

function fakeLlm() {
  return async (system: string, user: string) => {
    const buyer = system.includes("buyer's negotiating agent");
    const round = Number(/Round (\d+) of/.exec(user)![1]);
    const price = buyer ? [0.6, 0.7, 0.75][round - 1] : [0.9, 0.8, 0.75][round - 1];
    return JSON.stringify({ reasoning: "x", offer: { price, quantity: 1, round } });
  };
}

describe("USDC amounts and addresses", () => {
  it("converts 6dp amounts exactly", () => {
    expect(usdcToAtomic(0.75)).toBe(BigInt(750000));
    expect(usdcToAtomic("0.712345")).toBe(BigInt(712345));
    expect(atomicToUsdc(BigInt(1000000))).toBe("1");
    expect(atomicToUsdc(BigInt(712340))).toBe("0.71234");
    expect(() => usdcToAtomic("0.1234567")).toThrow();
  });
  it("accepts Solana public keys and rejects other strings", () => {
    expect(isSolanaAddress(PAYOUT)).toBe(true);
    expect(isSolanaAddress("0x2bCE00000000000000000000000000000000958E")).toBe(false);
    expect(isSolanaAddress("not-an-address")).toBe(false);
  });
});

describe("on-chain transfer check", () => {
  const want = { signature: SIG, recipient: PAYOUT, amountAtomic: BigInt(750000) };
  it("accepts exactly the agreed USDC to the payout address", () => {
    const c = checkParsedTransfer(tx("750000"), want);
    expect(c.ok).toBe(true);
    expect(c.sender).toBe(SENDER);
  });
  it("refuses a different amount, a failed tx, the wrong mint, a missing tx and an older tx", () => {
    expect(checkParsedTransfer(tx("760000"), want).ok).toBe(false);
    expect(checkParsedTransfer(tx("750000", { err: { InstructionError: [0, "x"] } }), want).ok).toBe(false);
    expect(checkParsedTransfer(tx("750000", { mint: "So11111111111111111111111111111111111111112" }), want).ok).toBe(false);
    expect(checkParsedTransfer(null, want).ok).toBe(false);
    expect(checkParsedTransfer(tx("750000", { blockTime: 100 }), { ...want, notBefore: 200 }).ok).toBe(false);
  });
});

describe("real settlement request in a sealed deal", () => {
  it("records a payment request (not a payment), never labelled simulated, and verifies", async () => {
    const settler = new KitePendingSettler({ chain: "solana", address: PAYOUT });
    const r = await negotiate({ item: "Demo pass", quantity: 1, referencePrice: 0.75, buyerCeiling: 0.9, sellerFloor: 0.5, buyerStyle: "balanced", sellerStyle: "balanced", buyerMaxRounds: 3, sellerMaxRounds: 3, attackMode: false, budget: 1, settler }, () => {}, fakeLlm());
    expect(r.outcome.status).toBe("closed");
    const s = r.settlement!;
    expect(s.live).toBe(false);
    expect(s.simulated).toBe(false);
    expect(isRealPaymentRequest(s)).toBe(true);
    expect(s.payment.code).toBe("awaiting_owner_approval");
    expect(s.session.payee).toBe(PAYOUT);
    const kinds = r.log.filter((e) => e.kind.startsWith("settle.") || e.kind === "mandate.open").map((e) => e.payload.simulated);
    expect(kinds.every((v) => v === false)).toBe(true);

    const pending = await verifyReceipt(r);
    expect(pending.filter((c) => c.ok === false)).toEqual([]);
    expect(pending.find((c) => c.id === "payment")?.detail).toContain("Not paid yet");

    const total = Number(r.outcome.total).toFixed(6);
    const paid = { ...r, onchainPayment: { chain: "solana-mainnet" as const, asset: "USDC" as const, mint: USDC_MINT_SOLANA, amount: total, amountAtomic: usdcToAtomic(total).toString(), recipient: PAYOUT, signature: SIG, explorerUrl: `https://solscan.io/tx/${SIG}`, verifiedAt: new Date().toISOString() } };
    const done = await verifyReceipt(paid);
    expect(done.find((c) => c.id === "payment")?.ok).toBe(true);

    const wrong = await verifyReceipt({ ...paid, onchainPayment: { ...paid.onchainPayment, recipient: SENDER } });
    expect(wrong.find((c) => c.id === "payment")?.ok).toBe(false);
  });
});

describe("Solana RPC fallbacks", () => {
  const want = { signature: SIG, recipient: PAYOUT, amountAtomic: BigInt(750000) };
  const parsed = tx("750000");
  const statuses = { value: [{ confirmationStatus: "finalized" }] };

  function mockRpc(plan: Record<string, { status?: number; result?: unknown; error?: { message: string } | null; fail?: boolean }>) {
    return async (url: string | URL | Request, init?: RequestInit) => {
      const key = String(url);
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
      const entry = plan[`${key} ${body.method}`] ?? plan[key];
      if (!entry) throw new Error(`unexpected rpc ${key} ${body.method}`);
      if (entry.fail) throw new Error("network down");
      const status = entry.status ?? 200;
      return new Response(JSON.stringify(entry.error ? { jsonrpc: "2.0", id: 1, error: entry.error } : { jsonrpc: "2.0", id: 1, result: entry.result }), { status, headers: { "Content-Type": "application/json" } });
    };
  }

  it("lists CORS-friendly RPCs and the same-origin proxy for the browser, not the official endpoint first", () => {
    const browser = solanaRpcEndpoints({ browser: true });
    expect(browser[0]).toBe("https://public.rpc.solanavibestation.com");
    expect(browser).toContain("https://solana-mainnet.gateway.tatum.io");
    expect(browser.at(-1)).toBe(SAME_ORIGIN_SOLANA_RPC);
    expect(browser.includes("https://api.mainnet-beta.solana.com")).toBe(false);
    const server = solanaRpcEndpoints({ browser: false, rpcUrl: "https://custom.example/rpc" });
    expect(server[0]).toBe("https://custom.example/rpc");
    expect(server).toContain("https://api.mainnet-beta.solana.com");
    expect(server).not.toContain(SAME_ORIGIN_SOLANA_RPC);
  });

  it("falls through an official-style HTTP 403 and accepts the next RPC's transaction", async () => {
    const fetcher = mockRpc({
      "https://api.mainnet-beta.solana.com getTransaction": { status: 403 },
      "https://public.rpc.solanavibestation.com getTransaction": { result: parsed },
      "https://public.rpc.solanavibestation.com getSignatureStatuses": { result: statuses },
    });
    const c = await verifyUsdcTransfer(want, { rpcUrls: ["https://api.mainnet-beta.solana.com", "https://public.rpc.solanavibestation.com"], fetcher: fetcher as unknown as typeof fetch });
    expect(c.ok).toBe(true);
    expect(c.confirmationStatus).toBe("finalized");
    expect(c.rpcUsed).toBe("https://public.rpc.solanavibestation.com");
    expect(c.sender).toBe(SENDER);
  });

  it("still refuses the wrong amount after a successful RPC read", async () => {
    const fetcher = mockRpc({
      "https://public.rpc.solanavibestation.com getTransaction": { result: tx("750000") },
    });
    const c = await verifyUsdcTransfer({ ...want, amountAtomic: BigInt(860000) }, { rpcUrls: ["https://public.rpc.solanavibestation.com"], fetcher: fetcher as unknown as typeof fetch });
    expect(c.ok).toBe(false);
    expect(c.reason).toContain("0.75");
  });

  it("refuses the official USDC mint being swapped for another token", () => {
    const c = checkParsedTransfer(tx("750000", { mint: "So11111111111111111111111111111111111111112" }), want);
    expect(c.ok).toBe(false);
    expect(c.mint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("guards the proxy to read-only methods and valid signatures", () => {
    expect(proxyRpcRequestError("sendTransaction", [SIG])).toBeTruthy();
    expect(proxyRpcRequestError("getTransaction", ["not-a-sig"])).toBeTruthy();
    expect(proxyRpcRequestError("getTransaction", [SIG])).toBeNull();
    expect(proxyRpcRequestError("getSignatureStatuses", [[SIG]])).toBeNull();
    expect(proxyRpcRequestError("getSignatureStatuses", [[]])).toBeTruthy();
  });

  it("forwards through the next server RPC when the first returns 403", async () => {
    const fetcher = mockRpc({
      "https://api.mainnet-beta.solana.com getTransaction": { status: 403 },
      "https://api.mainnet.solana.com getTransaction": { result: parsed },
    });
    const r = await forwardSolanaRpc("getTransaction", [SIG, { encoding: "jsonParsed" }], { fetcher: fetcher as unknown as typeof fetch, rpcUrl: "https://api.mainnet-beta.solana.com" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toEqual(parsed);
  });

  it("surfaces a single error when every RPC fails", async () => {
    const fetcher = mockRpc({
      "https://dead.example getTransaction": { status: 403 },
    });
    await expect(rpcWithFallback(["https://dead.example"], "getTransaction", [SIG], fetcher as unknown as typeof fetch)).rejects.toThrow(/failed on every endpoint/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { checkKiteTestnetAnchor } from "@/lib/verify";

const CONTRACT = "0x19119ea2c1fc5d7d0941472e9cd362d809c78ec6";
const WRITER = "0x7E678E756Fe8e0eF5E9919550C5c4263e4e66533";
const DEAL = "deal_testnet_anchor";
const FINAL_HASH = "a".repeat(64);
const REFEREE_HASH = "b".repeat(64);
const RECEIPT = {
  dealId: DEAL,
  finalHash: FINAL_HASH,
  referee: { hash: REFEREE_HASH, files: [] },
};

afterEach(() => vi.unstubAllGlobals());

function word(value: string) {
  return value.replace(/^0x/i, "").padStart(64, "0");
}

function stubRpc(finalHash: string, refereeHash: string, blockTime: bigint) {
  const result = `0x${word(finalHash)}${word(refereeHash)}${word(blockTime.toString(16))}${word(WRITER)}`;
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ jsonrpc: "2.0", id: 1, result }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Kite testnet anchor verifier", () => {
  it("reports an absent record without treating it as a payment failure", async () => {
    const fetchMock = stubRpc("0x" + "0".repeat(64), "0x" + "0".repeat(64), 0n);
    const check = await checkKiteTestnetAnchor(RECEIPT, true);

    expect(check.id).toBe("kite-testnet-anchor");
    expect(check.ok).toBeNull();
    expect(check.detail).toMatch(/No anchor record/);
    expect(check.detail).toMatch(/does not affect payment or settlement/);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const request = JSON.parse(String(init.body));
    expect(url).toBe("https://rpc-testnet.gokite.ai/");
    expect(request.method).toBe("eth_call");
    expect(request.params[0].to).toBe(CONTRACT);
  });

  it("accepts matching final and referee hashes from the deployed contract", async () => {
    const fetchMock = stubRpc(FINAL_HASH, REFEREE_HASH, 1_800_000_000n);
    const check = await checkKiteTestnetAnchor(RECEIPT, true);

    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/Matches the receipt's final and referee hashes/);
    expect(check.detail).toContain(WRITER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a chain record that differs from the receipt or whose log is invalid", async () => {
    stubRpc("c".repeat(64), REFEREE_HASH, 1_800_000_000n);
    const mismatch = await checkKiteTestnetAnchor(RECEIPT, true);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.detail).toMatch(/Does NOT match/);

    stubRpc(FINAL_HASH, REFEREE_HASH, 1_800_000_000n);
    const invalidLog = await checkKiteTestnetAnchor(RECEIPT, false);
    expect(invalidLog.ok).toBe(false);
  });
});

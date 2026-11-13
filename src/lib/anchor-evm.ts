import "server-only";
import { createWalletClient, http, defineChain, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Anchorer, AnchorRecord } from "./anchor";

const ABI = [
  {
    type: "function", name: "anchor", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "dealId", type: "bytes32" }, { name: "finalHash", type: "bytes32" }, { name: "refereeHash", type: "bytes32" }],
  },
] as const;

/** Writes one hash per deal. Only active when ANCHOR_ENABLED=1 and all env vars are set. */
export class EvmAnchorer implements Anchorer {
  constructor(private cfg: { rpc: string; chainId: number; contract: `0x${string}`; key: `0x${string}`; explorer: string; name: string }) {}
  async anchor(dealId: string, finalHash: string, refereeHash: string): Promise<AnchorRecord> {
    const chain = defineChain({
      id: this.cfg.chainId, name: this.cfg.name, nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
      rpcUrls: { default: { http: [this.cfg.rpc] } },
    });
    const client = createWalletClient({ account: privateKeyToAccount(this.cfg.key), chain, transport: http(this.cfg.rpc) });
    const txHash = await client.writeContract({
      address: this.cfg.contract, abi: ABI, functionName: "anchor",
      args: [keccak256(toBytes(dealId)), `0x${finalHash}`, `0x${refereeHash}`],
    });
    return { status: "anchored", chain: this.cfg.name, chainId: this.cfg.chainId, contract: this.cfg.contract, txHash, explorerUrl: `${this.cfg.explorer}/tx/${txHash}`, finalHash };
  }
}

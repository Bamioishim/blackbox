/**
 * Anchoring is pluggable. Today nothing is anchored: no contract is deployed and no funds are spent.
 * contracts/SealedAnchor.sol + anchor-evm.ts show the one-transaction design.
 */
export type AnchorRecord =
  | { status: "not_anchored"; reason: string; plannedChain: string }
  | { status: "anchored"; chain: string; chainId: number; contract: string; txHash: string; explorerUrl: string; finalHash: string };

export interface Anchorer {
  anchor(dealId: string, finalHash: string, refereeHash: string): Promise<AnchorRecord>;
}

export class NotAnchored implements Anchorer {
  async anchor(): Promise<AnchorRecord> {
    return {
      status: "not_anchored",
      reason: "Not anchored yet. The anchor contract is written but not deployed; deploying needs the owner's approval and a little gas.",
      plannedChain: "Kite AI testnet (chain 2368), then Kite mainnet (chain 2366)",
    };
  }
}

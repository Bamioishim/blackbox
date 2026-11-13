/**
 * Anchoring is pluggable. The live path writes the deal's final hash to Solana
 * mainnet as an SPL Memo (`blackbox:<dealId>:<finalHash>`). The unused EVM
 * contract in contracts/BlackboxAnchor.sol remains as an optional Kite path.
 */
export type AnchorRecord =
  | { status: "not_anchored"; reason: string; plannedChain: string }
  | {
      status: "anchored";
      chain: string;
      chainId?: number;
      contract?: string;
      program?: string;
      writer?: string;
      memo?: string;
      txHash: string;
      explorerUrl: string;
      finalHash: string;
      block?: number;
      slot?: number;
      blockTime?: number;
    };

export interface Anchorer {
  anchor(dealId: string, finalHash: string, refereeHash: string): Promise<AnchorRecord>;
}

export class NotAnchored implements Anchorer {
  async anchor(): Promise<AnchorRecord> {
    return {
      status: "not_anchored",
      reason: "Not anchored yet. After a deal settles, Blackbox writes the final hash to Solana mainnet as an SPL Memo when the anchor wallet is configured.",
      plannedChain: "Solana mainnet (SPL Memo)",
    };
  }
}

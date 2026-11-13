/**
 * A verified real settlement, recorded after an on-chain check.
 *
 * This is a completed Kite Passport wallet send on Solana mainnet, confirmed
 * with getTransaction (jsonParsed, maxSupportedTransactionVersion 0) on a
 * public mainnet RPC. It is not produced by the in-app settle(deal) path.
 * New deals still go through MockKiteSettler and must stay labelled SIMULATED.
 *
 * Official USDC mint on Solana is EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.
 */
export const REAL_SETTLEMENT_LABEL = "Real settlement (Kite Passport, Solana mainnet)" as const;

export const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type RealSettlement = {
  label: typeof REAL_SETTLEMENT_LABEL;
  live: true;
  simulated: false;
  mode: "kite-mainnet";
  chain: "solana-mainnet";
  asset: "USDC";
  amount: "1";
  amountAtomic: "1000000";
  decimals: 6;
  mint: typeof USDC_MINT_SOLANA;
  from: string;
  to: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  signature: string;
  explorerUrl: string;
  kiteRequestId: string;
  slot: number;
  blockTime: number;
  /** Africa/Lagos (WAT, UTC+1), derived from the Solana block time. */
  settledAtWat: string;
  settledAtIso: string;
  feeLamports: number;
  note: string;
};

export const KITE_SOLANA_USDC_SETTLEMENT: RealSettlement = {
  label: REAL_SETTLEMENT_LABEL,
  live: true,
  simulated: false,
  mode: "kite-mainnet",
  chain: "solana-mainnet",
  asset: "USDC",
  amount: "1",
  amountAtomic: "1000000",
  decimals: 6,
  mint: USDC_MINT_SOLANA,
  from: "ABVbrFkJoTEtBHvh7AiSBH11HLo5XbwSU9vJoUajZahN",
  to: "BYwZAHbD38RvEihmJgy7E95CMKJ3mLXy3tEEs48cPaQx",
  fromTokenAccount: "992sNAMs1cmLp8kh4jScvA3Ymr8vBPBijdTndy8Gms7g",
  toTokenAccount: "2xPLVQZiAeVs4s62q1QBRdhzt3WXrLbsAEiZYbYTJRKW",
  signature: "3jHaiNfAZA2phuiHpbbxm933aMxDsiYw9946ZEqvXtyzUMb9T2sHRq47upvyrgetNrr8MsK1ABUJ5Y4vLgrLM2pM",
  explorerUrl: "https://solscan.io/tx/3jHaiNfAZA2phuiHpbbxm933aMxDsiYw9946ZEqvXtyzUMb9T2sHRq47upvyrgetNrr8MsK1ABUJ5Y4vLgrLM2pM",
  kiteRequestId: "wallet_send_req_01a1d1bc-ec7d-7cce-9c86-f7ec03979c63",
  slot: 468681920,
  blockTime: 1794520204,
  settledAtWat: "2026-11-12 22:50:04 WAT",
  settledAtIso: "2026-11-12T22:50:04+01:00",
  feeLamports: 5000,
  note: "Verified on Solana mainnet after Kite Passport passkey approval. This was the first rail test, a direct wallet send. Marketplace deals now settle the same way when the buyer chooses to settle for real; those payments appear on each deal.",
};

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

/**
 * Verify a USDC transfer on Solana mainnet from a transaction signature.
 *
 * Reads the transaction with getTransaction (jsonParsed) and checks, from the
 * token balance changes Solana itself records:
 *  - the transaction succeeded (meta.err is null) and is at least "confirmed"
 *  - the recipient wallet (token-account owner) gained exactly `amountAtomic`
 *    of the official USDC mint
 *  - optionally, the block time is not earlier than `notBefore` (so an older
 *    transfer can't be reused for a new deal)
 */
import { USDC_MINT_SOLANA } from "./real-settlement";

export const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const B58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A base58 string that decodes to exactly 32 bytes (a Solana public key). */
export function isSolanaAddress(value: string): boolean {
  if (typeof value !== "string" || value.length < 32 || value.length > 44 || !B58.test(value)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const c of value) n = n * BigInt(58) + BigInt(alphabet.indexOf(c));
  let bytes = 0;
  while (n > BigInt(0)) { n >>= BigInt(8); bytes++; }
  let leading = 0;
  for (const c of value) { if (c === "1") leading++; else break; }
  return bytes + leading === 32;
}

/** A Solana transaction signature: base58, 64 bytes (86–88 chars). */
export function isSolanaSignature(value: string): boolean {
  return typeof value === "string" && value.length >= 80 && value.length <= 90 && B58.test(value);
}

/** "0.712345" USDC -> 712345 atomic units (6 decimals), exact for 6dp inputs. */
export function usdcToAtomic(amount: number | string): bigint {
  const s = typeof amount === "number" ? amount.toFixed(6) : amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error("bad USDC amount");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * BigInt(1000000) + BigInt((frac + "000000").slice(0, 6));
}
export function atomicToUsdc(atomic: bigint): string {
  const whole = atomic / BigInt(1000000);
  const frac = (atomic % BigInt(1000000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export type TransferCheck = {
  ok: boolean;
  reason?: string;
  signature: string;
  recipient: string;
  mint: string;
  amountAtomic: string;
  receivedAtomic?: string;
  sender?: string;
  slot?: number;
  blockTime?: number;
  confirmationStatus?: string;
  explorerUrl: string;
};

type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

async function rpc(url: string, method: string, params: unknown[], fetcher: typeof fetch) {
  const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error(`Solana RPC ${method} returned HTTP ${res.status}`);
  const j = await res.json() as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(`Solana RPC ${method}: ${j.error.message ?? "error"}`);
  return j.result;
}

/** Pure check over a jsonParsed getTransaction result (exported for tests). */
export function checkParsedTransfer(
  tx: any,
  want: { signature: string; recipient: string; amountAtomic: bigint; notBefore?: number; mint?: string },
): TransferCheck {
  const mint = want.mint ?? USDC_MINT_SOLANA;
  const base: TransferCheck = { ok: false, signature: want.signature, recipient: want.recipient, mint, amountAtomic: want.amountAtomic.toString(), explorerUrl: `https://solscan.io/tx/${want.signature}` };
  if (!tx) return { ...base, reason: "Transaction not found on Solana mainnet (yet)." };
  if (tx.meta?.err) return { ...base, reason: "Transaction failed on chain." };
  const pre: TokenBal[] = tx.meta?.preTokenBalances ?? [];
  const post: TokenBal[] = tx.meta?.postTokenBalances ?? [];
  const delta = new Map<string, bigint>();
  for (const b of post) if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? BigInt(0)) + BigInt(b.uiTokenAmount.amount));
  for (const b of pre) if (b.mint === mint && b.owner) delta.set(b.owner, (delta.get(b.owner) ?? BigInt(0)) - BigInt(b.uiTokenAmount.amount));
  const received = delta.get(want.recipient) ?? BigInt(0);
  let sender: string | undefined;
  for (const [owner, d] of delta) if (d < BigInt(0)) sender = owner;
  const out: TransferCheck = { ...base, receivedAtomic: received.toString(), sender, slot: tx.slot, blockTime: tx.blockTime ?? undefined };
  if (received !== want.amountAtomic) return { ...out, reason: `Recipient received ${atomicToUsdc(received)} USDC, expected ${atomicToUsdc(want.amountAtomic)} USDC.` };
  if (want.notBefore !== undefined && (tx.blockTime ?? 0) < want.notBefore) return { ...out, reason: "Transaction is older than this payment request; it can't settle this deal." };
  return { ...out, ok: true };
}

export async function verifyUsdcTransfer(
  want: { signature: string; recipient: string; amountAtomic: bigint; notBefore?: number },
  opts: { rpcUrl?: string; fetcher?: typeof fetch } = {},
): Promise<TransferCheck> {
  const url = opts.rpcUrl || process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC;
  const f = opts.fetcher ?? fetch;
  if (!isSolanaSignature(want.signature)) return { ok: false, reason: "Not a Solana transaction signature.", signature: want.signature, recipient: want.recipient, mint: USDC_MINT_SOLANA, amountAtomic: want.amountAtomic.toString(), explorerUrl: "" };
  const tx = await rpc(url, "getTransaction", [want.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], f);
  const check = checkParsedTransfer(tx, want);
  if (!check.ok) return check;
  const st = await rpc(url, "getSignatureStatuses", [[want.signature], { searchTransactionHistory: true }], f) as { value?: ({ confirmationStatus?: string } | null)[] };
  const cs = st?.value?.[0]?.confirmationStatus;
  if (cs !== "confirmed" && cs !== "finalized") return { ...check, ok: false, confirmationStatus: cs, reason: "Transaction is not confirmed yet." };
  return { ...check, confirmationStatus: cs };
}

/**
 * Final-hash anchoring on Solana mainnet: one SPL Memo transaction
 * whose data is `blackbox:<dealId>:<finalHash>`.
 *
 * The public verifier re-reads that transaction and checks the memo,
 * the writer, and the hash against the receipt. The writer address is
 * published here so a receipt cannot point at some other wallet's memo.
 */
import { isSolanaAddress, isSolanaSignature, rpcWithFallback, solanaRpcEndpoints } from "./solana-verify";

export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Legacy memo program, still accepted when verifying. */
export const MEMO_PROGRAM_ID_V1 = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";
export const BLACKBOX_ANCHOR_SOLANA = "3G8NByQCiNgECMhRCFZUBFFVeu3zdgEb2igFfkjBAtS8";

const DEAL_ID = /^deal_[a-z0-9_-]{6,40}$/;
const HASH = /^[0-9a-f]{64}$/;

export function normalizeFinalHash(finalHash: string): string {
  return finalHash.trim().replace(/^0x/i, "").toLowerCase();
}

export function anchorMemo(dealId: string, finalHash: string): string {
  const id = dealId.trim();
  const hash = normalizeFinalHash(finalHash);
  if (!DEAL_ID.test(id)) throw new Error("bad deal id");
  if (!HASH.test(hash)) throw new Error("bad final hash");
  return `blackbox:${id}:${hash}`;
}

export function parseAnchorMemo(memo: string): { dealId: string; finalHash: string } | null {
  const m = /^blackbox:(deal_[a-z0-9_-]{6,40}):([0-9a-f]{64})$/.exec(memo.trim());
  return m ? { dealId: m[1], finalHash: m[2] } : null;
}

function isMemoProgram(id: string | undefined): boolean {
  return id === MEMO_PROGRAM_ID || id === MEMO_PROGRAM_ID_V1;
}

function pubkeyOf(k: unknown): string | undefined {
  if (typeof k === "string") return k;
  if (k && typeof k === "object" && "pubkey" in k && typeof (k as { pubkey: unknown }).pubkey === "string") {
    return (k as { pubkey: string }).pubkey;
  }
  return undefined;
}

function instructionMemo(ix: any): string | null {
  if (!ix) return null;
  const programId = String(ix.programId ?? ix.programIdIndex ?? "");
  const program = String(ix.program ?? "");
  if (!isMemoProgram(programId) && program !== "spl-memo") return null;
  if (typeof ix.parsed === "string" && ix.parsed.trim()) return ix.parsed.trim();
  if (ix.parsed && typeof ix.parsed === "object") {
    const info = (ix.parsed as { info?: unknown; memo?: unknown }).info ?? (ix.parsed as { memo?: unknown }).memo;
    if (typeof info === "string" && info.trim()) return info.trim();
  }
  return null;
}

/** Every memo string found in a jsonParsed getTransaction result. */
export function memosFromParsedTx(tx: any): string[] {
  const out: string[] = [];
  const add = (s: string | null) => { if (s && !out.includes(s)) out.push(s); };
  const msg = tx?.transaction?.message;
  for (const ix of msg?.instructions ?? []) add(instructionMemo(ix));
  for (const inner of tx?.meta?.innerInstructions ?? []) {
    for (const ix of inner?.instructions ?? []) add(instructionMemo(ix));
  }
  for (const log of tx?.meta?.logMessages ?? []) {
    const m = /Memo \(len \d+\): "?(.*?)"?$/.exec(String(log));
    if (m) add(m[1]);
  }
  return out;
}

export function writersFromParsedTx(tx: any): string[] {
  const keys: unknown[] = tx?.transaction?.message?.accountKeys ?? [];
  const out: string[] = [];
  for (const k of keys) {
    if (k && typeof k === "object" && (k as { signer?: boolean }).signer === true) {
      const p = pubkeyOf(k);
      if (p) out.push(p);
    }
  }
  // Legacy jsonParsed may return bare pubkey strings; the fee payer (index 0) is always a signer.
  if (out.length === 0 && keys.length) {
    const first = pubkeyOf(keys[0]);
    if (first) out.push(first);
  }
  return out;
}

export type MemoAnchorCheck = {
  ok: boolean | null;
  reason?: string;
  signature: string;
  memo?: string;
  writer?: string;
  slot?: number;
  blockTime?: number;
  confirmationStatus?: string;
  explorerUrl: string;
  rpcUsed?: string;
};

/** Pure check over a jsonParsed getTransaction result. */
export function checkParsedMemo(
  tx: any,
  want: { signature: string; dealId: string; finalHash: string; writer?: string },
): MemoAnchorCheck {
  const explorerUrl = `https://solscan.io/tx/${want.signature}`;
  const expected = anchorMemo(want.dealId, want.finalHash);
  const writer = want.writer ?? BLACKBOX_ANCHOR_SOLANA;
  const base: MemoAnchorCheck = { ok: false, signature: want.signature, explorerUrl };
  if (!tx) return { ...base, reason: "Transaction not found on Solana mainnet (yet)." };
  if (tx.meta?.err) return { ...base, reason: "Transaction failed on chain." };
  const memos = memosFromParsedTx(tx);
  const memo = memos.find((m) => m === expected);
  const writers = writersFromParsedTx(tx);
  const out: MemoAnchorCheck = { ...base, memo: memo ?? memos[0], writer: writers[0], slot: tx.slot, blockTime: tx.blockTime ?? undefined };
  if (!memo) return { ...out, reason: memos.length ? `Memo does not match this deal's final hash.` : "No SPL Memo instruction in this transaction." };
  if (writer && !writers.includes(writer)) return { ...out, reason: `Memo was not signed by the Blackbox anchor wallet (${writer}).` };
  return { ...out, ok: true, memo, writer: writers.find((w) => w === writer) ?? writers[0] };
}

export async function verifyMemoAnchor(
  want: { signature: string; dealId: string; finalHash: string; writer?: string },
  opts: { rpcUrl?: string; rpcUrls?: string[]; fetcher?: typeof fetch } = {},
): Promise<MemoAnchorCheck> {
  const explorerUrl = `https://solscan.io/tx/${want.signature}`;
  if (!isSolanaSignature(want.signature)) return { ok: false, reason: "Not a Solana transaction signature.", signature: want.signature, explorerUrl };
  if (want.writer && !isSolanaAddress(want.writer)) return { ok: false, reason: "Not a Solana anchor address.", signature: want.signature, explorerUrl };
  try {
    anchorMemo(want.dealId, want.finalHash);
  } catch {
    return { ok: false, reason: "Bad deal id or final hash.", signature: want.signature, explorerUrl };
  }
  const urls = opts.rpcUrls ?? solanaRpcEndpoints({ rpcUrl: opts.rpcUrl });
  const f = opts.fetcher ?? fetch;
  const got = await rpcWithFallback(urls, "getTransaction", [want.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], f);
  const check = checkParsedMemo(got.result, want);
  if (!check.ok) return { ...check, rpcUsed: got.url };
  try {
    const st = await rpcWithFallback(urls, "getSignatureStatuses", [[want.signature], { searchTransactionHistory: true }], f);
    const cs = (st.result as { value?: ({ confirmationStatus?: string } | null)[] })?.value?.[0]?.confirmationStatus;
    if (cs !== "confirmed" && cs !== "finalized") return { ...check, ok: false, confirmationStatus: cs, rpcUsed: st.url, reason: "Transaction is not confirmed yet." };
    return { ...check, confirmationStatus: cs, rpcUsed: st.url };
  } catch (e) {
    return { ...check, ok: null, rpcUsed: got.url, reason: `Couldn't confirm the signature (${(e as Error).message}). Check by hand: ${explorerUrl}` };
  }
}

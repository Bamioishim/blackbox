import "server-only";
import { ed25519 } from "@noble/curves/ed25519";
import { NotAnchored, type Anchorer, type AnchorRecord } from "./anchor";
import { EvmAnchorer } from "./anchor-evm";
import { BLACKBOX_ANCHOR_SOLANA, MEMO_PROGRAM_ID, anchorMemo } from "./solana-memo";
import { rpcWithFallback, solanaRpcEndpoints } from "./solana-verify";

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const CU_LIMIT = 80_000;
const CU_PRICE_MICRO = 10_000;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s: string): Uint8Array {
  let n = BigInt(0);
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * BigInt(58) + BigInt(i);
  }
  const out: number[] = [];
  while (n > BigInt(0)) {
    out.push(Number(n & BigInt(0xff)));
    n >>= BigInt(8);
  }
  out.reverse();
  let lead = 0;
  for (const c of s) { if (c === "1") lead++; else break; }
  return Uint8Array.from([...Array(lead).fill(0), ...out]);
}

function b58encode(bytes: Uint8Array): string {
  let n = BigInt(0);
  for (const b of bytes) n = (n << BigInt(8)) + BigInt(b);
  let out = "";
  while (n > BigInt(0)) {
    const r = n % BigInt(58);
    out = B58[Number(r)] + out;
    n /= BigInt(58);
  }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out || "1";
}

function shortvec(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  while (true) {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
    if (!v) break;
  }
  return out;
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function u64le(n: number): number[] {
  const x = BigInt(n);
  const out: number[] = [];
  let v = x;
  for (let i = 0; i < 8; i++) { out.push(Number(v & BigInt(0xff))); v >>= BigInt(8); }
  return out;
}

export function parseSolanaSecret(raw: string): Uint8Array {
  const t = raw.trim();
  if (t.startsWith("[")) {
    const arr = JSON.parse(t) as number[];
    if (!Array.isArray(arr) || (arr.length !== 64 && arr.length !== 32)) throw new Error("ANCHOR_SOLANA_SECRET_KEY must be a 32- or 64-byte JSON array.");
    return Uint8Array.from(arr);
  }
  const bytes = b58decode(t);
  if (bytes.length !== 64 && bytes.length !== 32) throw new Error("ANCHOR_SOLANA_SECRET_KEY must be a 32- or 64-byte secret.");
  return bytes;
}

function keypairFromSecret(secret: Uint8Array): { secret: Uint8Array; publicKey: Uint8Array; address: string } {
  const seed = secret.length === 64 ? secret.slice(0, 32) : secret;
  const publicKey = ed25519.getPublicKey(seed);
  return { secret: seed, publicKey, address: b58encode(publicKey) };
}

function buildLegacyTx(opts: { payer: Uint8Array; seed: Uint8Array; memo: Uint8Array; blockhash: Uint8Array }): Uint8Array {
  const payer = opts.payer;
  const budget = b58decode(COMPUTE_BUDGET_PROGRAM);
  const memoProg = b58decode(MEMO_PROGRAM_ID);
  if (payer.length !== 32 || budget.length !== 32 || memoProg.length !== 32 || opts.blockhash.length !== 32) {
    throw new Error("bad solana key or blockhash length");
  }
  // accounts: 0 payer (signed, writable), 1 compute budget (unsigned ro), 2 memo program (unsigned ro)
  const keys = [payer, budget, memoProg];
  const limitData = Uint8Array.from([2, ...u32le(CU_LIMIT)]);
  const priceData = Uint8Array.from([3, ...u64le(CU_PRICE_MICRO)]);
  const ixs: { program: number; accounts: number[]; data: Uint8Array }[] = [
    { program: 1, accounts: [], data: limitData },
    { program: 1, accounts: [], data: priceData },
    { program: 2, accounts: [0], data: opts.memo },
  ];
  const header = [1, 0, 2]; // 1 required signature, 0 readonly signed, 2 readonly unsigned
  const msg: number[] = [...header, ...shortvec(keys.length)];
  for (const k of keys) msg.push(...k);
  msg.push(...opts.blockhash);
  msg.push(...shortvec(ixs.length));
  for (const ix of ixs) {
    msg.push(ix.program, ...shortvec(ix.accounts.length), ...ix.accounts, ...shortvec(ix.data.length), ...ix.data);
  }
  const message = Uint8Array.from(msg);
  const sig = ed25519.sign(message, opts.seed);
  return Uint8Array.from([...shortvec(1), ...sig, ...message]);
}

async function rpc(method: string, params: unknown[]) {
  return rpcWithFallback(solanaRpcEndpoints({ browser: false }), method, params, fetch);
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function solanaAnchorConfigured(): boolean {
  return Boolean(process.env.ANCHOR_SOLANA_SECRET_KEY?.trim());
}

/** Writes `blackbox:<dealId>:<finalHash>` as an SPL Memo on Solana mainnet. */
export class SolanaMemoAnchorer implements Anchorer {
  async anchor(dealId: string, finalHash: string): Promise<AnchorRecord> {
    const raw = process.env.ANCHOR_SOLANA_SECRET_KEY?.trim();
    if (!raw) throw new Error("ANCHOR_SOLANA_SECRET_KEY is not set.");
    const kp = keypairFromSecret(parseSolanaSecret(raw));
    if (kp.address !== BLACKBOX_ANCHOR_SOLANA) {
      throw new Error("ANCHOR_SOLANA_SECRET_KEY does not match the published Blackbox anchor wallet.");
    }
    const memo = anchorMemo(dealId, finalHash);
    const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const blockhashStr = (bh.result as { value?: { blockhash?: string } })?.value?.blockhash;
    if (!blockhashStr) throw new Error("Solana RPC did not return a recent blockhash.");
    const tx = buildLegacyTx({ payer: kp.publicKey, seed: kp.secret, memo: new TextEncoder().encode(memo), blockhash: b58decode(blockhashStr) });
    const sent = await rpc("sendTransaction", [b64(tx), { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }]);
    const signature = String(sent.result ?? "");
    if (!signature) throw new Error("Solana RPC did not return a signature.");
    let slot: number | undefined;
    let status: string | undefined;
    let err: unknown;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const st = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
      const val = (st.result as { value?: ({ confirmationStatus?: string; err?: unknown; slot?: number } | null)[] })?.value?.[0];
      if (!val) continue;
      err = val.err;
      status = val.confirmationStatus;
      slot = val.slot;
      if (err) throw new Error(`Anchor transaction failed on chain: ${JSON.stringify(err)}`);
      if (status === "confirmed" || status === "finalized") break;
    }
    if (err) throw new Error(`Anchor transaction failed on chain: ${JSON.stringify(err)}`);
    if (status !== "confirmed" && status !== "finalized") throw new Error("Anchor transaction was not confirmed in time.");
    return {
      status: "anchored",
      chain: "solana-mainnet",
      program: MEMO_PROGRAM_ID,
      writer: kp.address,
      memo,
      txHash: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
      finalHash: finalHash.replace(/^0x/i, "").toLowerCase(),
      slot,
    };
  }
}

export function getAnchorer(): Anchorer {
  const e = process.env;
  if (solanaAnchorConfigured()) return new SolanaMemoAnchorer();
  if (e.ANCHOR_ENABLED === "1" && e.ANCHOR_RPC_URL && e.ANCHOR_CONTRACT && e.ANCHOR_PRIVATE_KEY && e.ANCHOR_CHAIN_ID) {
    return new EvmAnchorer({
      rpc: e.ANCHOR_RPC_URL, chainId: Number(e.ANCHOR_CHAIN_ID), contract: e.ANCHOR_CONTRACT as `0x${string}`,
      key: e.ANCHOR_PRIVATE_KEY as `0x${string}`, explorer: e.ANCHOR_EXPLORER ?? "https://testnet.kitescan.ai", name: e.ANCHOR_CHAIN_NAME ?? "Kite AI testnet",
    });
  }
  return new NotAnchored();
}

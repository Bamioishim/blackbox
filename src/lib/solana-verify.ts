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
 *
 * Public official RPCs 403 browser Origin headers. The browser tries CORS-
 * friendly mainnet RPCs first, then a same-origin proxy that retries several
 * server-side endpoints. The mint / amount / recipient check always runs on
 * the parsed result here, not on the proxy.
 */
import { USDC_MINT_SOLANA } from "./real-settlement";

export const DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/** Official Solana RPC. Works from servers; 403s when called with a browser Origin. */
export const SOLANA_OFFICIAL_RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://api.mainnet.solana.com",
] as const;

/**
 * Public mainnet RPCs that, when probed, accepted a browser Origin and
 * returned getTransaction with Access-Control-Allow-Origin.
 */
export const SOLANA_BROWSER_RPCS = [
  "https://public.rpc.solanavibestation.com",
  "https://solana-mainnet.gateway.tatum.io",
] as const;

/** Extra server-side fallbacks after the official endpoints. */
export const SOLANA_SERVER_FALLBACK_RPCS = [
  "https://solana-mainnet.gateway.tatum.io",
  "https://public.rpc.solanavibestation.com",
  "https://solana-rpc.publicnode.com",
] as const;

/** Same-origin proxy used only in the browser, after public CORS RPCs. */
export const SAME_ORIGIN_SOLANA_RPC = "/api/solana/rpc";

const RPC_TIMEOUT_MS = 8000;

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
  /** Endpoint that returned the transaction (a public RPC URL, or the same-origin proxy). */
  rpcUsed?: string;
};

type TokenBal = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } };

export function solanaRpcEndpoints(opts: { rpcUrl?: string; browser?: boolean } = {}): string[] {
  const browser = opts.browser ?? (typeof window !== "undefined");
  const envUrl = !browser && typeof process !== "undefined" ? process.env.SOLANA_RPC_URL : undefined;
  const out: string[] = [];
  const add = (u?: string) => { if (u && !out.includes(u)) out.push(u); };
  add(opts.rpcUrl);
  add(envUrl);
  if (browser) {
    for (const u of SOLANA_BROWSER_RPCS) add(u);
    add(SAME_ORIGIN_SOLANA_RPC);
  } else {
    for (const u of SOLANA_OFFICIAL_RPCS) add(u);
    for (const u of SOLANA_SERVER_FALLBACK_RPCS) add(u);
  }
  return out;
}

async function rpcOnce(url: string, method: string, params: unknown[], fetcher: typeof fetch, timeoutMs = RPC_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: ctrl.signal } as RequestInit);
    if (!res.ok) throw new Error(`Solana RPC ${method} returned HTTP ${res.status}`);
    const j = await res.json() as { result?: unknown; error?: { message?: string } };
    if (j.error) throw new Error(`Solana RPC ${method}: ${j.error.message ?? "error"}`);
    return j.result;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Solana RPC ${method} timed out`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function rpcWithFallback(
  urls: string[],
  method: string,
  params: unknown[],
  fetcher: typeof fetch,
): Promise<{ result: unknown; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const result = await rpcOnce(url, method, params, fetcher);
      return { result, url };
    } catch (e) {
      const host = url.startsWith("/") ? url : url.replace(/^https?:\/\//, "").split("/")[0];
      errors.push(`${host}: ${(e as Error).message}`);
    }
  }
  const last = errors[errors.length - 1] ?? "no endpoints";
  throw new Error(`Solana RPC ${method} failed on every endpoint (${last})`);
}

const PROXY_METHODS = new Set(["getTransaction", "getSignatureStatuses"]);

/** Guard for the same-origin proxy: only these two read methods, and only real signatures. */
export function proxyRpcRequestError(method: unknown, params: unknown): string | null {
  if (typeof method !== "string" || !PROXY_METHODS.has(method)) return "Only getTransaction and getSignatureStatuses are allowed.";
  if (!Array.isArray(params) || params.length < 1) return "Missing RPC params.";
  if (method === "getTransaction") {
    if (!isSolanaSignature(String(params[0] ?? ""))) return "Not a Solana transaction signature.";
  } else {
    const sigs = params[0];
    if (!Array.isArray(sigs) || sigs.length < 1 || sigs.length > 8 || sigs.some((s) => !isSolanaSignature(String(s ?? "")))) {
      return "Not a Solana transaction signature.";
    }
  }
  return null;
}

/** Server-side forwarder used by /api/solana/rpc. Never calls the same-origin proxy. */
export async function forwardSolanaRpc(
  method: string,
  params: unknown[],
  opts: { fetcher?: typeof fetch; rpcUrl?: string } = {},
): Promise<{ ok: true; result: unknown; rpc: string } | { ok: false; status: number; error: string }> {
  const bad = proxyRpcRequestError(method, params);
  if (bad) return { ok: false, status: 400, error: bad };
  try {
    const { result, url } = await rpcWithFallback(solanaRpcEndpoints({ rpcUrl: opts.rpcUrl, browser: false }), method, params, opts.fetcher ?? fetch);
    return { ok: true, result, rpc: url };
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message };
  }
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
  opts: { rpcUrl?: string; rpcUrls?: string[]; fetcher?: typeof fetch } = {},
): Promise<TransferCheck> {
  const urls = opts.rpcUrls ?? solanaRpcEndpoints({ rpcUrl: opts.rpcUrl });
  const f = opts.fetcher ?? fetch;
  if (!isSolanaSignature(want.signature)) return { ok: false, reason: "Not a Solana transaction signature.", signature: want.signature, recipient: want.recipient, mint: USDC_MINT_SOLANA, amountAtomic: want.amountAtomic.toString(), explorerUrl: "" };
  const got = await rpcWithFallback(urls, "getTransaction", [want.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], f);
  const check = checkParsedTransfer(got.result, want);
  if (!check.ok) return { ...check, rpcUsed: got.url };
  try {
    const st = await rpcOnce(got.url, "getSignatureStatuses", [[want.signature], { searchTransactionHistory: true }], f) as { value?: ({ confirmationStatus?: string } | null)[] };
    const cs = st?.value?.[0]?.confirmationStatus;
    if (cs !== "confirmed" && cs !== "finalized") return { ...check, ok: false, confirmationStatus: cs, rpcUsed: got.url, reason: "Transaction is not confirmed yet." };
    return { ...check, confirmationStatus: cs, rpcUsed: got.url };
  } catch {
    // The transfer itself already checked out; confirmation status is a second read.
    const st = await rpcWithFallback(urls, "getSignatureStatuses", [[want.signature], { searchTransactionHistory: true }], f);
    const cs = (st.result as { value?: ({ confirmationStatus?: string } | null)[] })?.value?.[0]?.confirmationStatus;
    if (cs !== "confirmed" && cs !== "finalized") return { ...check, ok: false, confirmationStatus: cs, rpcUsed: st.url, reason: "Transaction is not confirmed yet." };
    return { ...check, confirmationStatus: cs, rpcUsed: st.url };
  }
}

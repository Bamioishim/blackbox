// SPRINT WORK. Live validation on the one real, mainnet-anchored deal (deal_74b9a05fe8f4).
// Runs selected mutants through (a) the SHIPPED verifier with live Solana reads (--onchain path) and
// (b) a pinned, receipt-independent anchor lookup that reads the official anchor wallet's memo history.
// Read-only RPC calls; nothing is written on chain, no funds move. For the self-anchoring attack we do NOT
// write an attacker memo on mainnet: we serve that ONE attacker transaction from a local stub of
// getTransaction (clearly marked below); every other RPC call goes to real Solana mainnet.
import { readFileSync, writeFileSync } from "node:fs";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { verifyReceipt } from "../../src/lib/verify.ts";
import { rpcWithFallback, solanaRpcEndpoints } from "../../src/lib/solana-verify.ts";
import { memosFromParsedTx, parseAnchorMemo, MEMO_PROGRAM_ID } from "../../src/lib/solana-memo.ts";
import { OPS, Registry, rewriteLimits, clone, summaryBinding, OFFICIAL_WRITER } from "./lib.mts";
import { mulberry32 } from "./corpus.mts";
import type { Receipt } from "../../src/lib/receipt.ts";

const real: Receipt = JSON.parse(readFileSync("public/deals/deal_74b9a05fe8f4.json", "utf8"));
const rand = mulberry32(99);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeSig = () => Array.from({ length: 88 }, () => B58[Math.floor(rand() * 58)]).join("");
const ATTACKER_PUBKEY = Array.from({ length: 44 }, () => B58[Math.floor(rand() * 58)]).join("");

// ---- local stub for the attacker's (never-written) memo transaction ----
const stubbed = new Map<string, any>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  try {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const sig = Array.isArray(body.params) ? (Array.isArray(body.params[0]) ? body.params[0][0] : body.params[0]) : undefined;
    if (typeof sig === "string" && stubbed.has(sig)) {
      const tx = stubbed.get(sig);
      const result = body.method === "getTransaction" ? tx : body.method === "getSignatureStatuses" ? { value: [{ confirmationStatus: "finalized" }] } : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200, headers: { "content-type": "application/json" } });
    }
  } catch { /* fall through */ }
  return realFetch(url, init);
}) as typeof fetch;
function stubMemoTx(memo: string, signer: string) {
  const sig = fakeSig();
  stubbed.set(sig, { slot: 999999999, blockTime: Math.floor(Date.now() / 1000), meta: { err: null, logMessages: [] },
    transaction: { message: { accountKeys: [{ pubkey: signer, signer: true }], instructions: [{ programId: MEMO_PROGRAM_ID, program: "spl-memo", parsed: memo }] } } });
  return sig;
}

// ---- pinned lookup: earliest memo for this dealId written by the official anchor wallet ----
const urls = solanaRpcEndpoints();
let memoIndex: { dealId: string; finalHash: string; sig: string; slot: number }[] | null = null;
async function officialMemos() {
  if (memoIndex) return memoIndex;
  const sigs = (await rpcWithFallback(urls, "getSignaturesForAddress", [OFFICIAL_WRITER, { limit: 100 }], realFetch)).result as any[];
  memoIndex = [];
  for (const s of sigs) {
    if (s.err) continue;
    const tx = (await rpcWithFallback(urls, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }], realFetch)).result as any;
    const signers = (tx?.transaction?.message?.accountKeys ?? []).filter((k: any) => k.signer).map((k: any) => k.pubkey);
    if (!signers.includes(OFFICIAL_WRITER)) continue;
    for (const m of memosFromParsedTx(tx)) { const p = parseAnchorMemo(m); if (p) memoIndex.push({ ...p, sig: s.signature, slot: s.slot }); }
  }
  return memoIndex;
}
async function pinned(r: Receipt) {
  const ms = (await officialMemos()).filter((m) => m.dealId === r.dealId).sort((a, b) => a.slot - b.slot);
  if (!ms.length) return { ok: false, detail: "no memo for this deal from the official anchor wallet" };
  return { ok: ms[0].finalHash === r.finalHash && r.log[r.log.length - 1]?.hash === r.finalHash, detail: `official memo ${ms[0].finalHash.slice(0, 12)}… (tx ${ms[0].sig.slice(0, 10)}…, slot ${ms[0].slot})` };
}

const reg = new Registry();
const opById = (id: string) => OPS.find((o) => o.id === id)!;
const cases: { id: string; make: () => Promise<Receipt | null> }[] = [
  { id: "honest (unchanged)", make: async () => clone(real) },
  ...["n_offer_price", "c_offer_price", "c_close_price", "c_frame_injection", "c_backdate_all", "f_fabricate", "f_rewrite_limits", "d_strip_identity", "s_outcome_price", "s_terms_item"].map((id) => ({ id, make: async () => (await opById(id).apply(real, { rand, reg })) as Receipt | null })),
  { id: "f_rewrite_limits_strip_anchor", make: async () => { const f = rewriteLimits(real)!; f.anchor = { status: "not_anchored", reason: "Not anchored yet.", plannedChain: "Solana mainnet (SPL Memo)" }; return f; } },
  { id: "f_rewrite_limits_self_anchor (stubbed attacker tx)", make: async () => { const f = rewriteLimits(real)!; const memo = `blackbox:${f.dealId}:${f.finalHash}`; const sig = stubMemoTx(memo, ATTACKER_PUBKEY);
      f.anchor = { ...(f.anchor as any), status: "anchored", writer: ATTACKER_PUBKEY, txHash: sig, memo, finalHash: f.finalHash, explorerUrl: `https://solscan.io/tx/${sig}` }; return f; } },
];

const out: any[] = [];
for (const c of cases) {
  const r = await c.make();
  if (!r) { out.push({ case: c.id, skipped: true }); continue; }
  const checks = await verifyReceipt(r, undefined, { onchain: true });
  const failed = checks.filter((x) => x.ok === false).map((x) => x.id);
  const pending = checks.filter((x) => x.ok === null).map((x) => x.id);
  const anchorC = checks.find((x) => x.id === "anchor");
  const pin = await pinned(r);
  const sb = summaryBinding(r);
  const hardenedFlag = failed.filter((x) => x !== "anchor").length > 0 || !pin.ok || sb.length > 0;
  out.push({ case: c.id, shippedVerdict: failed.length ? "FAILED" : "HOLDS UP", failed, pending, anchorCheck: anchorC ? `${anchorC.ok} ${anchorC.detail.slice(0, 110)}` : null, pinnedAnchor: pin, summaryBinding: sb, hardenedVerdict: hardenedFlag ? "FLAGGED" : "HOLDS UP" });
  console.log(`${c.id.padEnd(52)} shipped(live): ${(failed.length ? "FAILED [" + failed.join(",") + "]" : "HOLDS UP").padEnd(44)} pinned: ${(pin.ok ? "match" : "MISMATCH").padEnd(9)} summary: ${(sb.join(",") || "ok").padEnd(30)} hardened: ${hardenedFlag ? "FLAGGED" : "HOLDS UP"}`);
}
writeFileSync("sprint/results/live_real_deal.json", JSON.stringify({ deal: real.dealId, ranAt: new Date().toISOString(), officialWriter: OFFICIAL_WRITER, officialMemos: memoIndex, attackerWriterStubbed: ATTACKER_PUBKEY, cases: out }, null, 1));

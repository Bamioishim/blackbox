// Anchor a receipt's final hash on Solana mainnet as an SPL Memo:
//   ANCHOR_SOLANA_SECRET_KEY='[...]' node --import tsx scripts/anchor-solana.mjs public/deals/deal_xxx.json
// The key is also read from ANCHOR_KEY_FILE (default /workspace/secrets/blackbox-anchor-keypair.json). It is never printed.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node --import tsx scripts/anchor-solana.mjs <receipt.json>"); process.exit(2); }
if (!process.env.ANCHOR_SOLANA_SECRET_KEY) {
  const keyFile = process.env.ANCHOR_KEY_FILE ?? "/workspace/secrets/blackbox-anchor-keypair.json";
  process.env.ANCHOR_SOLANA_SECRET_KEY = readFileSync(keyFile, "utf8").trim();
}
const { getAnchorer } = await import("../src/lib/anchor-solana.ts");
const r = JSON.parse(readFileSync(file, "utf8"));
const rec = r.receipt ?? r;
const anchor = await getAnchorer().anchor(rec.dealId, rec.finalHash, rec.referee?.hash ?? "");
if (r.receipt) r.receipt.anchor = anchor; else r.anchor = anchor;
writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
console.log(anchor.status, rec.dealId, anchor.status === "anchored" ? anchor.explorerUrl : anchor.reason);

// Verify a Blackbox receipt offline, without trusting the website. Usage:
//   npm run verify -- public/deals/deal_xxx.json
import { readFileSync } from "node:fs";
import { verifyReceipt, auditEntries } from "../src/lib/verify.ts";

const file = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!file) { console.error("usage: npm run verify -- <receipt.json> [--entries] [--onchain]"); process.exit(2); }
const r = JSON.parse(readFileSync(file, "utf8"));
const checks = await verifyReceipt(r, undefined, { onchain: process.argv.includes("--onchain") });
const audit = auditEntries(Array.isArray(r.log) ? r.log : []);
console.log(`${r.dealId}  ${audit.length} entries  final ${String(r.finalHash).slice(0, 16)}...`);
if (process.argv.includes("--entries")) {
  for (const a of audit) console.log(`${String(a.seq).padStart(3, "0")} ${a.hash === "ok" ? "HASH-OK " : "HASH-BAD"} ${a.rule === null ? "        " : a.rule === "ok" ? "RULE-OK " : "RULE-BAD"} ${a.kind.padEnd(18)} ${a.note}`);
}
const badEntries = audit.filter((a) => a.hash !== "ok" || a.rule === "fail");
console.log(`entries: ${audit.length - badEntries.length}/${audit.length} pass${badEntries.length ? `, first failure at #${badEntries[0].seq} (${badEntries[0].kind}): ${badEntries[0].note}` : ""}`);
for (const c of checks) console.log(c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "----", c.label, "-", c.detail);
const failed = checks.some((c) => c.ok === false) || badEntries.length > 0;
console.log(failed ? "RESULT: FAILED" : "RESULT: RECORD HOLDS UP");
process.exit(failed ? 1 : 0);

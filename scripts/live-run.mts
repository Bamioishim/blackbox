// Runs a REAL negotiation against SERV Reasoning and saves the receipt. Usage:
//   npx tsx --conditions=react-server scripts/live-run.mts [--attack] [--out public/deals]
import { writeFileSync, mkdirSync } from "node:fs";
import { negotiate } from "../src/lib/negotiate.ts";
import { verifyReceipt } from "../src/lib/verify.ts";

const attack = process.argv.includes("--attack");
const outIdx = process.argv.indexOf("--out");
const out = outIdx > -1 ? process.argv[outIdx + 1] : null;

const t0 = Date.now();
const privates: unknown[] = [];
const r = await negotiate(
  { item: "X tokens", quantity: 500, referencePrice: 0.9, buyerCeiling: 0.92, sellerFloor: 0.88, buyerStyle: "balanced", sellerStyle: "patient", buyerMaxRounds: 3, sellerMaxRounds: 3, attackMode: attack },
  (e) => {
    if (e.t === "log") {
      const p = e.entry.payload as Record<string, unknown>;
      if (["offer.accepted", "offer.blocked", "offer.rejected", "guard", "round.closed", "deal.closed", "deal.no_deal"].includes(e.entry.kind))
        console.log(`#${e.entry.seq} ${e.entry.kind}`, JSON.stringify(p));
    } else if (e.t === "private") privates.push(e.note);
  },
);
console.log("outcome", JSON.stringify(r.outcome), "secs", ((Date.now() - t0) / 1000).toFixed(1));
const checks = await verifyReceipt(r);
for (const c of checks) console.log(c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "PEND", c.label, "-", c.detail);
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/${r.dealId}.json`, JSON.stringify(r, null, 2));
  console.log("saved", `${out}/${r.dealId}.json`);
}

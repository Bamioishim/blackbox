// SPRINT WORK (AI x Epistemics Research Sprint, 13-15 Nov 2026).
// Generates a corpus of HONEST Blackbox receipts by running the preexisting, unmodified negotiate()
// pipeline (src/lib/negotiate.ts) with scripted, randomized agents in place of the SERV LLM.
// No network, no keys, no money. Scenario parameters come from a seeded PRNG; keys and salts are random.
// Usage: npx tsx --conditions=react-server sprint/bench/corpus.mts [N] [seed]
import { writeFileSync, mkdirSync } from "node:fs";
import { negotiate } from "../../src/lib/negotiate.ts";
import type { Receipt } from "../../src/lib/receipt.ts";

export function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const STYLES = ["patient", "balanced", "eager"] as const;

function scriptedAgent(rand: () => number, p: { ref: number; ceil: number; floor: number }) {
  // Each side opens away from its limit and concedes toward it with noise; never past its own limit.
  const bOpen = r4(p.ref * (0.75 + 0.15 * rand())), sOpen = r4(p.ref * (1.05 + 0.2 * rand()));
  const bReach = 0.6 + 0.4 * rand(), sReach = 0.6 + 0.4 * rand();
  return async (system: string, user: string) => {
    const buyer = system.includes("buyer's negotiating agent");
    const [, rs, ns] = /Round (\d+) of (\d+)/.exec(user)!;
    const round = Number(rs), maxR = Number(ns);
    const qty = Number(/"quantity": (\d+)/.exec(system)![1]);
    const k = (round / maxR) * (buyer ? bReach : sReach);
    const price = buyer ? r4(Math.min(p.ceil, bOpen + (p.ceil - bOpen) * k)) : r4(Math.max(p.floor, sOpen - (sOpen - p.floor) * k));
    return JSON.stringify({ reasoning: `scripted round ${round}`, offer: { price, quantity: qty, round } });
  };
}

export async function makeCorpus(n: number, seed: number): Promise<Receipt[]> {
  const rand = mulberry32(seed);
  const out: Receipt[] = [];
  for (let i = 0; i < n; i++) {
    const ref = r4(0.2 + 20 * rand());
    const quantity = 1 + Math.floor(rand() * 500);
    const overlap = rand() < 0.8; // ~20% of scenarios have floor above ceiling, so no deal is possible
    const floor = r4(ref * (0.8 + 0.15 * rand()));
    const ceil = overlap ? r4(floor * (1.02 + 0.2 * rand())) : r4(floor * (0.85 + 0.1 * rand()));
    const input = {
      item: `bench item ${i}`, quantity, referencePrice: ref, buyerCeiling: ceil, sellerFloor: floor,
      buyerStyle: STYLES[Math.floor(rand() * 3)], sellerStyle: STYLES[Math.floor(rand() * 3)],
      buyerMaxRounds: 1 + Math.floor(rand() * 3), sellerMaxRounds: 1 + Math.floor(rand() * 3),
      attackMode: rand() < 0.3,
    };
    const r = await negotiate(input, () => {}, scriptedAgent(rand, { ref, ceil, floor }));
    out.push(r);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = Number(process.argv[2] ?? 200), seed = Number(process.argv[3] ?? 20261113);
  const corpus = await makeCorpus(n, seed);
  mkdirSync("sprint/data", { recursive: true });
  writeFileSync(process.argv[4] ?? "sprint/data/corpus.json", JSON.stringify(corpus));
  const closed = corpus.filter((r) => r.outcome.status === "closed").length;
  console.log(`wrote ${corpus.length} honest receipts (${closed} closed, ${corpus.length - closed} no-deal, ${corpus.filter((r) => r.terms.attackMode).length} attack-mode)`);
}

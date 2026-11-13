// SPRINT WORK. Runs every mutation operator on every honest receipt and scores six verifier configurations.
// Usage: npx tsx --conditions=react-server sprint/bench/run.mts [corpus.json] [seed]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { OPS, CONFIGS, Registry, anchorHonest, judgeAll, rehash, clone, OFFICIAL_WRITER, type Op } from "./lib.mts";
import { mulberry32 } from "./corpus.mts";
import type { Receipt } from "../../src/lib/receipt.ts";

const corpusPath = process.argv[2] ?? "sprint/data/corpus.json";
const seed = Number(process.argv[3] ?? 7);
const rand = mulberry32(seed);
const honest: Receipt[] = JSON.parse(readFileSync(corpusPath, "utf8"));
const reg = new Registry();
for (const r of honest) anchorHonest(r, reg);

function leafPaths(o: any, pre: string[] = []): string[][] {
  if (o === null || typeof o !== "object") return [pre];
  return Object.entries(o).flatMap(([k, v]) => leafPaths(v, [...pre, k]));
}
function fuzz(r0: Receipt, withRehash: boolean): Receipt {
  const r = clone(r0);
  for (let tries = 0; tries < 20; tries++) {
    const e = r.log[Math.floor(rand() * r.log.length)];
    const paths = leafPaths(e.payload); const p = paths[Math.floor(rand() * paths.length)];
    if (!p.length) continue;
    let o: any = e.payload; for (const k of p.slice(0, -1)) o = o[k];
    const k = p[p.length - 1], v = o[k];
    if (typeof v === "number") o[k] = v === 0 ? 1 : Math.round(v * (1 + (rand() < 0.5 ? -1 : 1) * (0.01 + 0.3 * rand())) * 1e6) / 1e6;
    else if (typeof v === "string" && v.length) { const i = Math.floor(rand() * v.length); const ch = v[i] === "a" ? "b" : "a"; o[k] = v.slice(0, i) + ch + v.slice(i + 1); }
    else if (typeof v === "boolean") o[k] = !v;
    else continue;
    if (withRehash) rehash(r);
    return r;
  }
  return r;
}
const FUZZ: Op[] = [
  { id: "z_fuzz_naive", cls: "Z random fuzz", harmful: true, desc: "random leaf change in a random entry, no rehash", apply: (r) => fuzz(r, false) },
  { id: "z_fuzz_rehash", cls: "Z random fuzz", harmful: true, desc: "random leaf change in a random entry, rehash", apply: (r) => fuzz(r, true) },
];

type Row = { deal: string; status: string; attack: boolean; op: string; cls: string; harmful: boolean; config: string; pass: boolean; fired: string };
const rows: Row[] = [];
const t0 = Date.now();
for (const h of honest) {
  for (const op of [...OPS, ...FUZZ]) {
    const reps = op.cls.startsWith("Z") ? 3 : 1;
    for (let k = 0; k < reps; k++) {
      let m = await op.apply(h, { rand, reg });
      if (!m) continue;
      let useReg = reg;
      if (op.id.startsWith("p_")) {
        // pre-anchor forgery: the honest hash was never anchored; the operator anchors the fake one instead
        useReg = new Registry(); useReg.memos = reg.memos.filter((x) => x.dealId !== h.dealId);
        const memo = useReg.write(OFFICIAL_WRITER, m.dealId, m.finalHash);
        m.anchor = { ...(m.anchor as any), status: "anchored", writer: OFFICIAL_WRITER, txHash: memo.tx, finalHash: m.finalHash, memo: `blackbox:${m.dealId}:${m.finalHash}` };
      }
      const v = await judgeAll(m, useReg);
      for (const c of CONFIGS) rows.push({ deal: h.dealId, status: h.outcome.status, attack: h.terms.attackMode, op: op.id, cls: op.cls, harmful: op.harmful, config: c, pass: v[c].pass, fired: v[c].fired.join("|") });
    }
  }
}
mkdirSync("sprint/results", { recursive: true });
const tag = process.argv[4] ?? (corpusPath.includes("real") ? "real" : "synthetic");
writeFileSync(`sprint/results/rows_${tag}.csv`, ["deal,status,attack,op,cls,harmful,config,pass,fired", ...rows.map((r) => [r.deal, r.status, r.attack, r.op, r.cls, r.harmful, r.config, r.pass, r.fired].map((x) => `"${String(x)}"`).join(","))].join("\n"));

// summary
function wilson(k: number, n: number) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, w = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [Math.max(0, c - w), Math.min(1, c + w)]; }
const ops = [...OPS, ...FUZZ];
const summary: any[] = [];
for (const op of ops) for (const c of CONFIGS) {
  const rs = rows.filter((r) => r.op === op.id && r.config === c);
  const flagged = rs.filter((r) => !r.pass).length;
  const [lo, hi] = wilson(flagged, rs.length);
  summary.push({ op: op.id, cls: op.cls, harmful: op.harmful, desc: op.desc, config: c, n: rs.length, flagged, rate: rs.length ? flagged / rs.length : null, ci95: [lo, hi] });
}
writeFileSync(`sprint/results/summary_${tag}.json`, JSON.stringify({ corpus: corpusPath, seed, receipts: honest.length, rows: rows.length, seconds: (Date.now() - t0) / 1000, summary }, null, 1));
const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad("operator", 26), CONFIGS.map((c) => c.slice(0, 3)).join("    "), "  n");
for (const op of ops) {
  const cells = CONFIGS.map((c) => { const s = summary.find((x) => x.op === op.id && x.config === c); return s.n ? (100 * s.rate).toFixed(0).padStart(4) + "%" : "   - "; });
  console.log(pad(op.id, 26), cells.join("  "), "  ", summary.find((x) => x.op === op.id).n);
}
console.log(`${rows.length / CONFIGS.length} mutants in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

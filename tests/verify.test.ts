import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { auditEntries } from "@/lib/verify";
import { decisions, ticket } from "@/lib/view";
import { negotiate } from "@/lib/negotiate";

const dir = "public/deals";
const files = readdirSync(dir).filter((f) => f.startsWith("deal_"));
const load = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));

async function scripted(attackMode = true) {
  return negotiate({ item: "X tokens", quantity: 500, referencePrice: 0.9, buyerCeiling: 0.92, sellerFloor: 0.88, buyerStyle: "balanced", sellerStyle: "balanced", buyerMaxRounds: 3, sellerMaxRounds: 3, attackMode }, () => {}, async (system, user) => {
    const buyer = system.includes("buyer's negotiating agent");
    const round = Number(/Round (\d+) of/.exec(user)![1]);
    const price = buyer ? [0.85, 0.88, 0.9][round - 1] ?? 0.9 : [0.95, 0.93, 0.9][round - 1] ?? 0.9;
    return JSON.stringify({ reasoning: "x", offer: { price, quantity: 500, round } });
  });
}

describe("per-entry audit", () => {
  for (const f of files) {
    const r = load(f);
    if (r.example?.tampered) {
      it(`${f}: flags the edited entry, by hash and by referee replay`, () => {
        const a = auditEntries(r.log);
        const first = a.find((x) => x.hash !== "ok")!;
        expect(first.hash).toBe("broken");
        expect(first.kind).toBe("offer.accepted");
        expect(first.rule).toBe("fail");
        expect(a.slice(first.seq + 1).every((x) => x.hash === "after")).toBe(true);
      });
    } else {
      it(`${f}: every entry passes hash and rule checks`, () => {
        const a = auditEntries(r.log);
        expect(a.filter((x) => x.hash !== "ok" || x.rule === "fail")).toEqual([]);
        expect(a.filter((x) => x.rule === "ok").length).toBeGreaterThan(5);
      });
    }
  }

  it("re-checks the simulated backtrack refusal and catches a forged refusal", async () => {
    const r = await scripted();
    const a = auditEntries(r.log);
    const back = r.log.find((e) => e.payload.attackKind === "backtrack")!;
    expect(a[back.seq].rule).toBe("ok");
    // a referee that 'refused' a legal offer would be caught (hash fixed up so only the rule check fails)
    const t = structuredClone(r);
    (t.log[back.seq].payload as { attempted: number }).attempted = 0.95;
    expect(auditEntries(t.log)[back.seq].rule).toBe("fail");
  });

  it("decisions and the transaction ticket follow the log", async () => {
    const r = await scripted(false);
    const d = decisions(r.log);
    expect(d[0]).toMatchObject({ round: 1, side: "buyer", action: "open", price: 0.85 });
    expect(d.filter((x) => x.action === "accept").length).toBeGreaterThan(0);
    const t = ticket(r.log);
    expect(t.status).toBe("settled-mock");
    expect(t.total).toBe(450);
    expect(t.settlement?.live).toBe(false);
    const mid = ticket(r.log.slice(0, r.log.findIndex((e) => e.kind === "round.closed") + 1));
    expect(mid.status).toBe("negotiating");
    expect(mid.spread).toBeCloseTo(0.1);
  });
});

describe("verify CLI", () => {
  const run = (f: string) => spawnSync("npx", ["tsx", "scripts/verify.mts", f], { encoding: "utf8" });
  it("exits 0 on a good receipt and 1 on the tampered one", () => {
    const good = files.find((f) => !load(f).example?.tampered)!;
    const g = run(`${dir}/${good}`);
    expect(g.status).toBe(0);
    expect(g.stdout).toContain("RECORD HOLDS UP");
    const b = run(`${dir}/${files.find((f) => load(f).example?.tampered)}`);
    expect(b.status).toBe(1);
    expect(b.stdout).toContain("first failure at #");
  }, 30000);
});

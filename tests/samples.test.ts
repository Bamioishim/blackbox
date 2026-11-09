import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { verifyReceipt } from "@/lib/verify";

// The recorded deals in public/deals are real SERV Reasoning runs. They must keep verifying.
const dir = "public/deals";
const files = readdirSync(dir).filter((f) => f.startsWith("deal_"));

describe("recorded SERV deals", () => {
  it("there is at least one", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`${f} verifies with no failed checks`, async () => {
      const r = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
      const checks = await verifyReceipt(r);
      expect(checks.filter((c) => c.ok === false)).toEqual([]);
      expect(r.settlement?.live ?? false).toBe(false);
    });
  }
});

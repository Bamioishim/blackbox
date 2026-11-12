import { describe, expect, it } from "vitest";
import { FORMATION, FORMATION_CYCLE_MS, formationState } from "@/lib/formation";

describe("formation timeline", () => {
  it("spins for two seconds before the story begins", () => {
    expect(FORMATION.spinMs).toBe(2000);
    expect(formationState(0).phase).toBe("spin");
    expect(formationState(1999).phase).toBe("spin");
    expect(formationState(2000).phase).toBe("commit");
    expect(formationState(2000).caption).toMatch(/hidden/i);
  });

  it("walks through commitments, offers, referee, seal and receipt", () => {
    const phases = [0, 2000, 3600, 6400, 7600, 8700, 11000].map((t) => formationState(t).phase);
    expect(phases).toEqual(["spin", "commit", "offers", "referee", "seal", "receipt", "hold"]);
  });

  it("has offers converge monotonically during the offer beat", () => {
    const a = formationState(FORMATION.spinMs + FORMATION.commitMs + 200).offerProgress;
    const b = formationState(FORMATION.spinMs + FORMATION.commitMs + 1400).offerProgress;
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it("fades the story out at the end of the hold so the loop can restart", () => {
    const mid = formationState(FORMATION_CYCLE_MS - 2000);
    const end = formationState(FORMATION_CYCLE_MS - 20);
    expect(mid.phase).toBe("hold");
    expect(mid.receipt).toBeGreaterThan(0.8);
    expect(end.fadeOut).toBeGreaterThan(0.8);
    expect(end.receipt).toBeLessThan(0.3);
    expect(formationState(FORMATION_CYCLE_MS).phase).toBe("spin");
    expect(formationState(FORMATION_CYCLE_MS).buyerIn).toBe(0);
  });

  it("rests on the completed illustration when motion is reduced", () => {
    const s = formationState(0, true);
    expect(s.phase).toBe("hold");
    expect(s.yawNudge).toBe(0);
    expect(s.buyerIn).toBe(1);
    expect(s.offerProgress).toBe(1);
    expect(s.seal).toBe(1);
    expect(s.receipt).toBe(1);
    expect(s.fadeOut).toBe(0);
  });

  it("cycles at a stable length", () => {
    expect(FORMATION_CYCLE_MS).toBe(12900);
    expect(formationState(FORMATION_CYCLE_MS + 100).phase).toBe("spin");
  });
});

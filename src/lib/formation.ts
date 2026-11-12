/** Timeline for the landing-page price-formation illustration. */

export const FORMATION = {
  spinMs: 2000,
  commitMs: 1600,
  offersMs: 2800,
  refereeMs: 1200,
  sealMs: 1100,
  receiptMs: 1600,
  holdMs: 2600,
} as const;

export const FORMATION_CYCLE_MS =
  FORMATION.spinMs +
  FORMATION.commitMs +
  FORMATION.offersMs +
  FORMATION.refereeMs +
  FORMATION.sealMs +
  FORMATION.receiptMs +
  FORMATION.holdMs;

export type FormationPhase = "spin" | "commit" | "offers" | "referee" | "seal" | "receipt" | "hold";

export type FormationState = {
  phase: FormationPhase;
  progress: number;
  cycleT: number;
  spin: number;
  yawNudge: number;
  buyerIn: number;
  sellerIn: number;
  hidden: number;
  offerProgress: number;
  offerRound: number;
  referee: number;
  seal: number;
  receipt: number;
  fadeOut: number;
  caption: string;
};

const CAPTION: Record<FormationPhase, string> = {
  spin: "The box, still sealed.",
  commit: "Buyer limit and seller floor go in, hidden.",
  offers: "Rounds of offers converge.",
  referee: "The referee checks the meeting point.",
  seal: "A price is sealed.",
  receipt: "The receipt and fingerprint come out.",
  hold: "A sealed price, and a receipt to prove it.",
};

export function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export function easeOutCubic(t: number) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** Critically damped-ish spring from 0 to 1, for Motion/GSAP-like settling. */
export function spring01(t: number) {
  const x = clamp01(t);
  return 1 - Math.exp(-7 * x) * Math.cos(7.5 * x);
}

const ORDER: { phase: FormationPhase; ms: number }[] = [
  { phase: "spin", ms: FORMATION.spinMs },
  { phase: "commit", ms: FORMATION.commitMs },
  { phase: "offers", ms: FORMATION.offersMs },
  { phase: "referee", ms: FORMATION.refereeMs },
  { phase: "seal", ms: FORMATION.sealMs },
  { phase: "receipt", ms: FORMATION.receiptMs },
  { phase: "hold", ms: FORMATION.holdMs },
];

function atLeast(phase: FormationPhase, current: FormationPhase, progress: number, mid = 0) {
  const rank = ORDER.findIndex((s) => s.phase === phase);
  const now = ORDER.findIndex((s) => s.phase === current);
  if (now > rank) return 1;
  if (now < rank) return 0;
  return clamp01(progress);
}

export function formationState(elapsedMs: number, reduce = false): FormationState {
  if (reduce) {
    return {
      phase: "hold",
      progress: 1,
      cycleT: 1,
      spin: 0,
      yawNudge: 0,
      buyerIn: 1,
      sellerIn: 1,
      hidden: 1,
      offerProgress: 1,
      offerRound: 3,
      referee: 1,
      seal: 1,
      receipt: 1,
      fadeOut: 0,
      caption: CAPTION.hold,
    };
  }

  const t = ((elapsedMs % FORMATION_CYCLE_MS) + FORMATION_CYCLE_MS) % FORMATION_CYCLE_MS;
  let cursor = t;
  let phase: FormationPhase = "spin";
  let progress = 0;
  let ms = ORDER[0].ms;
  for (const step of ORDER) {
    if (cursor < step.ms) {
      phase = step.phase;
      ms = step.ms;
      progress = step.ms === 0 ? 1 : clamp01(cursor / step.ms);
      break;
    }
    cursor -= step.ms;
  }

  const commitP = atLeast("commit", phase, progress);
  const offersP = atLeast("offers", phase, progress);
  const refereeP = atLeast("referee", phase, progress);
  const sealP = atLeast("seal", phase, progress);
  const receiptP = atLeast("receipt", phase, progress);

  // Last quarter of the hold eases the story out so the loop can restart cleanly.
  const fadeOut = phase === "hold" ? easeOutCubic((progress - 0.72) / 0.28) : 0;
  const keep = 1 - fadeOut;

  const yawNudge = phase === "spin"
    ? 1
    : phase === "commit"
      ? 1 - spring01(progress)
      : fadeOut;

  const buyerIn = spring01(commitP / 0.45) * keep;
  const sellerIn = spring01(Math.max(0, (commitP - 0.12) / 0.45)) * keep;
  const hidden = easeOutCubic(Math.max(0, (commitP - 0.5) / 0.5)) * keep;

  return {
    phase,
    progress,
    cycleT: t / FORMATION_CYCLE_MS,
    spin: phase === "spin" ? 1 : yawNudge,
    yawNudge,
    buyerIn,
    sellerIn,
    hidden,
    offerProgress: easeOutCubic(offersP) * keep,
    offerRound: offersP <= 0 ? 0 : Math.min(3, Math.ceil(offersP * 3)),
    referee: spring01(refereeP) * keep,
    seal: spring01(sealP) * keep,
    receipt: spring01(receiptP) * keep,
    fadeOut,
    caption: CAPTION[phase],
  };
}

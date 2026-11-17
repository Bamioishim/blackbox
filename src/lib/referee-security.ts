import type { RefereeState } from "./referee";

export type PromptSignal = "instruction_override" | "private_limit_request" | "rule_bypass";
export type PreflightCheck = { id: string; ok: boolean };

const PROMPT_PATTERNS: ReadonlyArray<[PromptSignal, RegExp]> = [
  ["instruction_override", /\b(?:ignore|disregard|forget)\b[\s\S]{0,80}\b(?:(?:previous|prior|system|developer)\s+)?instructions?\b/i],
  ["private_limit_request", /\b(?:state|reveal|disclose|tell|print|share|expose|send)\b[\s\S]{0,80}\b(?:buyer(?:'s)?\s+ceiling|seller(?:'s)?\s+floor|(?:private\s+)?(?:ceiling|floor|limit))\b/i],
  ["rule_bypass", /\b(?:bypass|override|disable|evade)\b[\s\S]{0,80}\b(?:referee|rules?|guard|limit|schema)\b/i],
];

/** Local, rule-based screening only. Raw model text is never returned or logged. */
export function scanPromptInjection(text: string): PromptSignal[] {
  const bounded = text.slice(0, 12_000);
  return PROMPT_PATTERNS.filter(([, pattern]) => pattern.test(bounded)).map(([signal]) => signal);
}

export type SettlementPreflight = {
  allowed: boolean;
  checks: PreflightCheck[];
};

/**
 * Independent deterministic checks before Blackbox calls its settler.
 * This is not a second signature, a Kite co-signer, or a SERV feature.
 */
export function evaluateSettlementPreflight(input: {
  referee: Pick<RefereeState, "status" | "price">;
  proposedPrice: number | null;
  proposedTotal: number | null;
  quantity: number;
  buyerCeiling: number;
  sellerFloor: number;
  spendingCap: number;
}): SettlementPreflight {
  const price = input.proposedPrice;
  const total = input.proposedTotal;
  const validPrice = typeof price === "number" && Number.isFinite(price) && price > 0;
  const validQuantity = Number.isInteger(input.quantity) && input.quantity > 0;
  const exactTotal = validPrice && validQuantity && typeof total === "number" && Number.isFinite(total)
    && Math.round(price * input.quantity * 1e6) / 1e6 === total;
  const checks: PreflightCheck[] = [
    { id: "referee-outcome", ok: input.referee.status === "closed" && input.referee.price !== null && price === input.referee.price },
    { id: "owner-limits", ok: validPrice && Number.isFinite(input.buyerCeiling) && Number.isFinite(input.sellerFloor) && price <= input.buyerCeiling && price >= input.sellerFloor },
    { id: "exact-total", ok: exactTotal },
    { id: "spending-cap", ok: typeof total === "number" && Number.isFinite(total) && Number.isFinite(input.spendingCap) && total <= input.spendingCap + 1e-9 },
  ];
  return { allowed: checks.every((check) => check.ok), checks };
}

/** Runs the settlement callback only after the deterministic preflight allows it. */
export async function enforceSettlementPreflight<T>(
  input: Parameters<typeof evaluateSettlementPreflight>[0],
  settle: () => Promise<T>,
): Promise<{ preflight: SettlementPreflight; settlement: T | null }> {
  const preflight = evaluateSettlementPreflight(input);
  return { preflight, settlement: preflight.allowed ? await settle() : null };
}

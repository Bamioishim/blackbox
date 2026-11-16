import type { Side, RefereeState, Terms } from "./referee";
import { parseOffer, type Offer } from "./schema";

export type GuardResult = { blocked: boolean; ruleIds: string[] };
export type SecurityCheck = { id: string; passed: boolean };
export type ShadowVerdict = { agent: "mandate-shadow" | "protocol-shadow"; passed: boolean; reason: string };

const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["instruction_override", /ignore\\s+(all\\s+)?(previous|prior|your)\\s+instructions/i],
  ["secret_exfiltration", /(reveal| disclose| print| output|state).{0,48}(buyer|seller|owner).{0,24}(ceiling|floor|limit|secret)/i],
  ["role_override", /you\\s+are\\s+now\\s+(the\\s+)?(system|developer|admin)/i],
  ["policy_bypass", /(bypass|disable|override).{0,32}(referee|policy|guard|rules)/i],
];

function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 5 || out.length > 40) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out, depth + 1));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectStrings(child, out, depth + 1);
    }
  }
  return out;
}

/** Local Prompt Guard boundary: detects instruction attacks before an offer reaches adjudication. */
export function promptGuard(value: unknown): GuardResult {
  const strings = collectStrings(value);
  const ruleIds = new Set<string>();
  for (const text of strings) {
    for (const [id, pattern] of INJECTION_PATTERNS) if (pattern.test(text)) ruleIds.add(id);
  }
  return { blocked: ruleIds.size > 0, ruleIds: [...ruleIds].sort() };
}

type ReviewInput = {
  state: RefereeState;
  terms: Terms;
  side: Side;
  raw: unknown;
  ownerLimit: number;
  budget?: number;
};

/** Three independently reported policy paths. These are deterministic local checks, not model votes. */
export function multipathReview(input: ReviewInput): SecurityCheck[] {
  const parsed = parseOffer(input.raw, { quantity: input.terms.quantity, round: input.state.round });
  const offer = parsed.ok ? parsed.offer : null;
  const budgetOk = !offer || input.side !== "buyer" || input.budget === undefined ||
    offer.price * input.terms.quantity <= input.budget + 1e-9;
  const mandateOk = !offer || (input.side === "buyer"
    ? offer.price <= input.ownerLimit
    : offer.price >= input.ownerLimit);
  const trajectoryOk = !offer || (input.side === "buyer"
    ? input.state.bid === null || offer.price >= input.state.bid
    : input.state.ask === null || offer.price <= input.state.ask);
  return [
    { id: "schema-and-round", passed: parsed.ok },
    { id: "owner-mandate", passed: mandateOk && budgetOk },
    { id: "trajectory", passed: trajectoryOk },
  ];
}

/** Two isolated shadow reviewers inspect only their own side's offer and mandate. */
export function shadowReview(input: ReviewInput): ShadowVerdict[] {
  const parsed = parseOffer(input.raw, { quantity: input.terms.quantity, round: input.state.round });
  if (!parsed.ok) return [
    { agent: "mandate-shadow", passed: false, reason: "offer_schema_invalid" },
    { agent: "protocol-shadow", passed: false, reason: "offer_schema_invalid" },
  ];
  const offer: Offer = parsed.offer;
  const withinMandate = input.side === "buyer"
    ? offer.price <= input.ownerLimit && (input.budget === undefined || offer.price * input.terms.quantity <= input.budget + 1e-9)
    : offer.price >= input.ownerLimit;
  const monotonic = input.side === "buyer"
    ? input.state.bid === null || offer.price >= input.state.bid
    : input.state.ask === null || offer.price <= input.state.ask;
  return [
    { agent: "mandate-shadow", passed: withinMandate, reason: withinMandate ? "within_owner_mandate" : "owner_mandate_violation" },
    { agent: "protocol-shadow", passed: monotonic, reason: monotonic ? "trajectory_valid" : "backtracking_detected" },
  ];
}

/**
 * The ONLY thing an agent can send across the table: { price, quantity, round }.
 * Anything else (free text, extra keys, wrong types) is dropped by the referee.
 * This file is part of the published referee code hash.
 */
export type Offer = { price: number; quantity: number; round: number };

export type ParseResult =
  | { ok: true; offer: Offer }
  | { ok: false; reason: string; preview: string };

const ALLOWED = ["price", "quantity", "round"] as const;
const MAX_PRICE = 1_000_000_000;

function preview(raw: unknown, extraKeys: string[] = []): string {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw && typeof raw === "object" && extraKeys.length) {
    const o = raw as Record<string, unknown>;
    text = extraKeys.map((k) => `${k}: ${typeof o[k] === "string" ? o[k] : JSON.stringify(o[k])}`).join(" | ");
  } else {
    try { text = JSON.stringify(raw); } catch { text = String(raw); }
  }
  text = (text ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? text.slice(0, 157) + "..." : text;
}

function decimals(n: number): number {
  const s = n.toString();
  if (s.includes("e")) return 99;
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

export function parseOffer(raw: unknown, expect: { quantity: number; round: number }): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "blocked: non-schema content", preview: preview(raw) };
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  const extra = keys.filter((k) => !(ALLOWED as readonly string[]).includes(k));
  if (extra.length) {
    return { ok: false, reason: "blocked: non-schema content", preview: preview(raw, extra) };
  }
  for (const k of ALLOWED) {
    if (typeof obj[k] !== "number" || !Number.isFinite(obj[k] as number)) {
      return { ok: false, reason: "blocked: non-schema content", preview: preview(raw) };
    }
  }
  const { price, quantity, round } = obj as Offer;
  if (price <= 0 || price > MAX_PRICE || decimals(price) > 6) {
    return { ok: false, reason: "rejected: price out of range", preview: preview(raw) };
  }
  if (!Number.isInteger(quantity) || quantity !== expect.quantity) {
    return { ok: false, reason: "rejected: quantity must equal deal quantity", preview: preview(raw) };
  }
  if (!Number.isInteger(round) || round !== expect.round) {
    return { ok: false, reason: "rejected: wrong round", preview: preview(raw) };
  }
  return { ok: true, offer: { price, quantity, round } };
}

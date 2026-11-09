import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes, randomBytes } from "@noble/hashes/utils";

/** Deterministic JSON: object keys sorted, no whitespace. Used for every hash in Sealed. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function randomHex(bytes = 16): string {
  return bytesToHex(randomBytes(bytes));
}

/** Fixed 6-decimal string so the same number always hashes the same way. */
export function fmtAmount(n: number): string {
  return n.toFixed(6);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

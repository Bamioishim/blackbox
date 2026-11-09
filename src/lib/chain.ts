import { canonical, sha256Hex } from "./canonical";

export const GENESIS = "0".repeat(64);

export type EntryKind =
  | "deal.open" | "commit" | "prompt" | "response" | "offer.accepted" | "offer.blocked"
  | "offer.rejected" | "guard" | "round.closed" | "deal.closed" | "deal.no_deal" | "reveal"
  | "settle.session" | "settle.payment" | "settle.enforcement" | "note";

export type LogEntry = {
  seq: number;
  ts: string;
  kind: EntryKind;
  actor: "referee" | "buyer" | "seller" | "buyer-agent" | "seller-agent" | "settlement" | "system";
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export function entryHash(e: Omit<LogEntry, "hash">): string {
  return sha256Hex(canonical({ seq: e.seq, ts: e.ts, kind: e.kind, actor: e.actor, payload: e.payload, prevHash: e.prevHash }));
}

export class HashChain {
  entries: LogEntry[] = [];
  constructor(private now: () => string = () => new Date().toISOString()) {}
  get head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  }
  append(kind: EntryKind, actor: LogEntry["actor"], payload: Record<string, unknown>): LogEntry {
    const base = { seq: this.entries.length, ts: this.now(), kind, actor, payload, prevHash: this.head };
    const entry: LogEntry = { ...base, hash: entryHash(base) };
    this.entries.push(entry);
    return entry;
  }
}

export type ChainCheck = { ok: boolean; brokenAt: number | null; reason: string | null; head: string };

export function verifyChain(entries: LogEntry[]): ChainCheck {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, brokenAt: i, reason: `entry ${i} has seq ${e.seq}`, head: prev };
    if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: `entry ${i} does not point at the previous hash`, head: prev };
    let recomputed: string;
    try { recomputed = entryHash(e); } catch { return { ok: false, brokenAt: i, reason: `entry ${i} is not hashable`, head: prev }; }
    if (recomputed !== e.hash) return { ok: false, brokenAt: i, reason: `entry ${i} was changed after it was written`, head: prev };
    prev = e.hash;
  }
  return { ok: true, brokenAt: null, reason: null, head: prev };
}

/** Private content (prompts, reasoning) is logged as a salted hash so the public log can't be brute-forced for limits. */
export function sealContent(content: string, salt: string): string {
  return sha256Hex(salt + "\u0000" + content);
}

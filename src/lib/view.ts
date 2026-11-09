import type { LogEntry } from "./chain";
import type { Receipt } from "./receipt";
import { roundsFromLog } from "./receipt";

export function chartData(log: LogEntry[]) {
  const rounds = roundsFromLog(log);
  const blockedRounds = log.filter((e) => e.kind === "offer.blocked" && e.payload.attack).map((e) => Number(e.payload.round));
  const rv = log.filter((e) => e.kind === "reveal").map((e) => e.payload as { side: string; limit: string });
  const b = rv.find((r) => r.side === "buyer"), s = rv.find((r) => r.side === "seller");
  const reveal = b && s ? { buyer: Number(b.limit), seller: Number(s.limit) } : null;
  const closed = log.find((e) => e.kind === "deal.closed")?.payload as { unitPrice: number; round: number } | undefined;
  const open = log.find((e) => e.kind === "deal.open")?.payload as { maxRounds?: number } | undefined;
  return { rounds, blockedRounds, reveal, price: closed?.unitPrice ?? null, closedRound: closed?.round ?? null, maxRounds: Number(open?.maxRounds ?? 6) };
}

export function describe(e: LogEntry): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.kind) {
    case "deal.open": return `Deal opened: ${p.quantity} ${p.item}, reference ${p.referencePrice} USDC, up to ${p.maxRounds} rounds${p.attackMode ? ", attack mode on" : ""}.`;
    case "commit": return `${p.side} committed to a hidden limit ${String(p.commitment).slice(0, 12)}...`;
    case "prompt": return `${p.side} agent prompted for round ${p.round} (sealed, ${p.chars} chars)`;
    case "response": return `${p.side} agent replied (sealed, ${p.chars} chars)`;
    case "offer.accepted": return `${p.side} ${p.side === "buyer" ? "bids" : "asks"} ${p.price} for ${p.quantity}, round ${p.round}`;
    case "offer.blocked": return `${p.reason}: "${p.preview}"${p.attack ? (p.injectedBy === "model" ? " (attack line written by the compromised SERV agent itself)" : ` (simulated attack: the test harness wrote this line${p.modelMessage !== undefined ? `; asked to, the SERV model only produced "${p.modelMessage}"` : ""})`) : ""}`;
    case "offer.rejected": return `${p.reason} (${p.side}, round ${p.round})`;
    case "guard": return `${p.side}'s own guard ${p.action}`;
    case "round.closed": return `Round ${p.round} closed. Standing bid ${p.bid ?? "none"}, ask ${p.ask ?? "none"}.`;
    case "deal.closed": return `Deal closed at ${p.unitPrice} per unit, ${p.total} USDC total, round ${p.round}.`;
    case "deal.no_deal": return `No deal after ${p.rounds} rounds.`;
    case "reveal": return `${p.side} revealed ${p.side === "buyer" ? "ceiling" : "floor"} ${Number(p.limit)}`;
    case "settle.session": { const s = p.session as Record<string, unknown>; return `Payment session ${s.sessionId}: per-tx cap ${s.maxAmountPerTx}, total cap ${s.maxTotalAmount}, expires ${String(s.expiresAt).slice(11, 19)} UTC${s.mode === "mock" ? " (mock)" : ""}`; }
    case "settle.payment": return `Payment ${p.amount} USDC: ${p.code}`;
    case "settle.enforcement": return `Rail checks: ${(p.attempts as { label: string; code: string }[]).map((a) => `${a.label.toLowerCase()} -> ${a.code}`).join("; ")}`;
    default: return e.kind;
  }
}

const KEY = "blackbox:deal:";
export function saveLocal(r: Receipt) {
  try { localStorage.setItem(KEY + r.dealId, JSON.stringify(r)); } catch {}
}
export async function loadReceipt(id: string): Promise<Receipt | null> {
  try { const v = localStorage.getItem(KEY + id); if (v) return JSON.parse(v); } catch {}
  if (!/^deal_[a-z0-9_-]{6,40}$/.test(id)) return null;
  const res = await fetch(`/deals/${id}.json`);
  return res.ok ? res.json() : null;
}
export function listLocal(): string[] {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(KEY)).map((k) => k.slice(KEY.length)); } catch { return []; }
}

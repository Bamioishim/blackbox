import type { LogEntry } from "./chain";
import type { Receipt } from "./receipt";
import { roundsFromLog } from "./receipt";

export function chartData(log: LogEntry[]) {
  const rounds = roundsFromLog(log);
  const blockedRounds = log.filter((e) => e.kind === "offer.blocked" && e.payload.attack).map((e) => Number(e.payload.round));
  const flags = log.filter((e) => (e.kind === "offer.blocked" || e.kind === "offer.rejected") && e.payload.attack)
    .map((e) => ({ round: Number(e.payload.round), label: e.payload.attackKind === "backtrack" ? "BID BACKTRACK REJECTED" : "INJECTION BLOCKED" }));
  const rv = log.filter((e) => e.kind === "reveal").map((e) => e.payload as { side: string; limit: string });
  const b = rv.find((r) => r.side === "buyer"), s = rv.find((r) => r.side === "seller");
  const reveal = b && s ? { buyer: Number(b.limit), seller: Number(s.limit) } : null;
  const closed = log.find((e) => e.kind === "deal.closed")?.payload as { unitPrice: number; round: number } | undefined;
  const open = log.find((e) => e.kind === "deal.open")?.payload as { maxRounds?: number } | undefined;
  return { rounds, blockedRounds, flags, reveal, price: closed?.unitPrice ?? null, closedRound: closed?.round ?? null, maxRounds: Number(open?.maxRounds ?? 6) };
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
    case "offer.rejected": return p.attackKind === "backtrack"
      ? `${p.reason}: tried ${p.attempted} after standing at a higher bid (simulated rule-break: the test harness rewrote the ${p.side}'s offer${p.modelPrice !== undefined ? `; the SERV model had sent ${p.modelPrice}` : ""})`
      : `${p.reason} (${p.side}, round ${p.round})`;
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

export type Decision = { round: number; side: "buyer" | "seller"; action: "open" | "counter" | "accept" | "hold" | "walk"; price: number | null; prev: number | null; seq: number };

/** What each agent decided, round by round, read from the public log (offers only, no private text). */
export function decisions(log: LogEntry[]): Decision[] {
  const out: Decision[] = [];
  const last: Record<"buyer" | "seller", number | null> = { buyer: null, seller: null };
  for (const e of log) {
    if (e.kind !== "round.closed") continue;
    const r = Number(e.payload.round);
    const acc = log.filter((x) => x.kind === "offer.accepted" && Number(x.payload.round) === r);
    const closedHere = e.payload.status === "closed";
    const noDeal = e.payload.status === "no_deal";
    for (const side of ["buyer", "seller"] as const) {
      const o = acc.find((x) => x.payload.side === side);
      const price = o ? Number(o.payload.price) : null;
      const other = side === "buyer" ? (e.payload.ask as number | null) : (e.payload.bid as number | null);
      let action: Decision["action"];
      if (price === null) action = noDeal ? "walk" : "hold";
      else if (closedHere && other !== null && (side === "buyer" ? price >= other : price <= other)) action = "accept";
      else if (noDeal) action = "walk";
      else action = last[side] === null ? "open" : "counter";
      out.push({ round: r, side, action, price, prev: last[side], seq: o?.seq ?? e.seq });
      if (price !== null) last[side] = price;
    }
  }
  return out;
}

export type Ticket = {
  quantity: number; item: string; bid: number | null; ask: number | null; spread: number | null;
  unitPrice: number | null; total: number | null; status: "waiting" | "negotiating" | "agreed" | "settled-mock" | "settled-live" | "no-deal" | "stopped";
  settlement: { mode: string; live: boolean; code: string; ref?: string; sessionId?: string; cap?: string; explorer?: string } | null;
  round: number;
};

/** The live transaction the agents' decisions are building. Updates per log entry. */
export function ticket(log: LogEntry[], stopped = false): Ticket {
  const open = log.find((e) => e.kind === "deal.open")?.payload as { quantity?: number; item?: string } | undefined;
  const rc = log.filter((e) => e.kind === "round.closed");
  const lastRc = rc[rc.length - 1]?.payload as { bid: number | null; ask: number | null } | undefined;
  const closed = log.find((e) => e.kind === "deal.closed")?.payload as { unitPrice: number; total: number } | undefined;
  const noDeal = log.some((e) => e.kind === "deal.no_deal");
  const sess = log.find((e) => e.kind === "settle.session")?.payload as { session?: { sessionId: string; maxTotalAmount: string } } | undefined;
  const pay = log.find((e) => e.kind === "settle.payment")?.payload as { code: string; ref?: string; mode: string; explorer?: string } | undefined;
  const bid = lastRc?.bid ?? null, ask = lastRc?.ask ?? null;
  const live = !!pay && pay.mode !== "mock" && /settled/.test(pay.code) && !/mock/.test(pay.code);
  return {
    quantity: Number(open?.quantity ?? 0), item: String(open?.item ?? ""), bid, ask,
    spread: bid !== null && ask !== null ? Math.round((ask - bid) * 1e6) / 1e6 : null,
    unitPrice: closed?.unitPrice ?? null, total: closed?.total ?? null,
    status: pay ? (live ? "settled-live" : "settled-mock") : closed ? "agreed" : noDeal ? "no-deal" : stopped ? "stopped" : log.length ? "negotiating" : "waiting",
    settlement: pay ? { mode: pay.mode, live, code: pay.code, ref: pay.ref, sessionId: sess?.session?.sessionId, cap: sess?.session?.maxTotalAmount, explorer: pay.explorer } : null,
    round: rc.length,
  };
}

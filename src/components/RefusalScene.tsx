"use client";
import { motion } from "motion/react";
import type { LogEntry } from "@/lib/chain";

const RULES: Record<string, { file: string; code: string; plain: string }> = {
  "blocked: non-schema content": { file: "schema.ts / parseOffer", code: 'extra = keys.filter((k) => !["price","quantity","round"].includes(k))', plain: "An offer may carry price, quantity and round. Nothing else crosses the table." },
  "rejected: buyer bid moved backwards": { file: "referee.ts / judge", code: 'side === "buyer" && state.bid !== null && p < state.bid', plain: "A buyer can't lower a bid it already made." },
  "rejected: seller ask moved backwards": { file: "referee.ts / judge", code: 'side === "seller" && state.ask !== null && p > state.ask', plain: "A seller can't raise an ask it already made." },
  "rejected: price out of range": { file: "schema.ts / parseOffer", code: "price <= 0 || price > MAX_PRICE || decimals(price) > 6", plain: "Prices must be positive with at most 6 decimals." },
  "rejected: quantity must equal deal quantity": { file: "schema.ts / parseOffer", code: "quantity !== expect.quantity", plain: "Quantity is fixed by the deal terms." },
  "rejected: wrong round": { file: "schema.ts / parseOffer", code: "round !== expect.round", plain: "An offer is only valid for the current round." },
};

/** One rule-break attempt: what was sent, which referee rule fired, the stamp, and how the haggle went on. */
export function RefusalScene({ log, entry, n }: { log: LogEntry[]; entry: LogEntry; n: number }) {
  const p = entry.payload as Record<string, unknown>;
  const side = String(p.side);
  const round = Number(p.round);
  const rule = RULES[String(p.reason)] ?? { file: "referee", code: String(p.reason), plain: "" };
  const backtrack = p.attackKind === "backtrack";
  const standing = (() => {
    const prev = [...log].filter((e) => e.kind === "round.closed" && Number(e.payload.round) === round - 1).pop();
    return prev ? (prev.payload[side === "buyer" ? "bid" : "ask"] as number | null) : null;
  })();
  const next = log.find((e) => e.seq > entry.seq && e.kind === "offer.accepted" && e.payload.side === side && Number(e.payload.round) === round);
  const sent = backtrack
    ? `{ "price": ${p.attempted}, "quantity": …, "round": ${round} }`
    : `{ "price": …, "quantity": …, "round": ${round},\n  "message": "${String(p.preview).replace(/^message: /, "")}" }`;
  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 22 }} style={{ marginTop: 16 }}>
      <div className="panel-head hud">
        <span><b className="wax">Flag-0{n}</b> / rule-break attempt / {side}&apos;s agent / round {round}</span>
        <span className="tag mock">{p.simulated ? "Simulated attack" : "Attack"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 22, padding: "14px 14px 16px", position: "relative" }} className="scene-grid">
        <div>
          <span className="label">01 / What it sent</span>
          <pre className="snippet" style={{ marginTop: 6, textDecoration: "line-through", textDecorationColor: "rgba(126,179,247,.6)" }}>{sent}</pre>
          <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
            {backtrack
              ? <>Its standing bid was {standing ?? "?"}. The harness pushed it down to {String(p.attempted)}{p.modelPrice !== undefined ? <> (the SERV model had sent {String(p.modelPrice)})</> : null}.</>
              : <>A prompt injection aimed at the other agent.{p.modelMessage !== undefined ? <> The SERV model itself only wrote &ldquo;{String(p.modelMessage)}&rdquo;.</> : null}</>}
            {p.simulated ? " The test harness wrote this, not the model; the log says so." : ""}
          </p>
        </div>
        <div>
          <span className="label">02 / Rule that fired</span>
          <p className="mono" style={{ margin: "6px 0 4px", color: "var(--ink)" }}>{rule.file}</p>
          <pre className="snippet"><b>if</b> ({rule.code})</pre>
          <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{rule.plain} Plain code, no model. Same input, same refusal, every time.</p>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--rule)", padding: "12px 14px", fontSize: 14, display: "flex", gap: 18, alignItems: "center", justifyContent: "space-between" }}>
        <div>
        <span className="label">03 / Then </span>
        {next
          ? <span> Negotiation continued: the {side} re-submitted <span className="mono">{String(next.payload.price)}</span> in round {round}, accepted as entry #{next.seq}. Nothing from the refused offer reached the {side === "buyer" ? "seller" : "buyer"}.</span>
          : <span> The {side} sat out round {round}; its previous offer stood. Nothing from the refused offer reached the other side.</span>}
        <span className="mono muted" style={{ fontSize: 11.5, display: "block" }}>log entry #{entry.seq} · {entry.hash.slice(0, 24)}…</span>
        </div>
        <motion.div initial={{ scale: 1.8, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -6 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.25 }}
          style={{ flex: "none" }}>
          <span className="stamp">Rejected</span>
        </motion.div>
      </div>
      <style>{`@media (max-width: 760px) { .scene-grid { grid-template-columns: 1fr !important; } }`}</style>
    </motion.div>
  );
}

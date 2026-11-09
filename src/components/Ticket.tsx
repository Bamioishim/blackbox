"use client";
import { motion, AnimatePresence } from "motion/react";
import type { LogEntry } from "@/lib/chain";
import { decisions, ticket } from "@/lib/view";

const STATUS: Record<string, string> = {
  waiting: "Waiting", negotiating: "Negotiating", agreed: "Agreed / settling", "settled-mock": "Settled (mock)", "settled-live": "Settled on Kite", "no-deal": "No deal / nothing paid", stopped: "Stopped / nothing paid",
};
const f = (n: number | null, d = 4) => (n === null ? "-" : Number(n.toFixed(d)).toString());

/** The transaction the agents are building. Every decision moves it; it ends in settle(deal). */
export function Ticket({ log, stopped = false }: { log: LogEntry[]; stopped?: boolean }) {
  const t = ticket(log, stopped);
  const ds = decisions(log);
  const s = t.settlement;
  return (
    <div className="panel" style={{ position: "sticky", top: 20 }}>
      <div className="panel-head hud"><span>Field report 02 / <b>transaction ticket</b></span><span className={t.status.startsWith("settled") || t.status === "agreed" ? "wax" : ""}>{STATUS[t.status]}</span></div>
      <div className="readouts" style={{ borderTop: 0, gridAutoFlow: "row", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ paddingLeft: 14 }}><span className="hud">Quantity</span><span className="v">{t.quantity || "-"} {t.item}</span></div>
        <div><span className="hud">Round</span><span className="v">{t.round || "-"}</span></div>
        <div style={{ paddingLeft: 14, borderTop: "1px solid var(--rule)" }}><span className="hud">Standing bid / ask</span><span className="v">{f(t.bid)} / {f(t.ask)}</span></div>
        <div style={{ borderTop: "1px solid var(--rule)" }}><span className="hud">Spread</span><span className="v" style={{ color: t.spread !== null && t.spread <= 0 ? "var(--wax)" : undefined }}>{t.spread === null ? "-" : t.spread <= 0 ? "crossed" : f(t.spread)}</span></div>
        <div style={{ paddingLeft: 14, borderTop: "1px solid var(--rule)" }}><span className="hud">Unit price</span><span className="v">{t.unitPrice !== null ? `${t.unitPrice} USDC` : "open"}</span></div>
        <div style={{ borderTop: "1px solid var(--rule)" }}><span className="hud">Total</span><motion.span key={String(t.total)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="v" style={{ color: t.total !== null ? "var(--wax)" : undefined }}>{t.total !== null ? `${t.total} USDC` : t.bid !== null && t.ask !== null ? `${f(t.bid * t.quantity, 2)}–${f(t.ask * t.quantity, 2)}` : "-"}</motion.span></div>
      </div>
      <div style={{ padding: "8px 14px 4px" }}>
        <span className="label">Decisions that moved the ticket</span>
        <ol style={{ listStyle: "none", margin: "6px 0 0", padding: 0, maxHeight: 210, overflow: "auto" }} data-lenis-prevent>
          <AnimatePresence initial={false}>
            {ds.length === 0 && <li className="muted" style={{ fontSize: 13.5, padding: "6px 0" }}>Each agent decision lands here: open, counter, accept, hold or walk.</li>}
            {ds.map((d) => (
              <motion.li key={`${d.round}-${d.side}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 240, damping: 24 }}
                style={{ display: "grid", gridTemplateColumns: "34px 58px 76px 1fr", gap: 8, padding: "5px 0", borderBottom: "1px dashed var(--rule)", fontSize: 13 }} className="mono">
                <span className="muted">R{d.round}</span>
                <span style={{ color: "var(--ink-2)" }}>{d.side}</span>
                <span style={{ color: d.action === "accept" ? "var(--wax)" : d.action === "walk" || d.action === "hold" ? "var(--muted)" : "var(--ink)", textTransform: "uppercase" }}>{d.action}</span>
                <span>{d.price !== null ? <>{d.price}{d.prev !== null && d.prev !== d.price ? <span className="muted"> ({d.price > d.prev ? "+" : ""}{f(d.price - d.prev)})</span> : null}<span className="muted"> → {f(d.price * t.quantity, 2)} total</span></> : <span className="muted">no valid offer, previous stands</span>}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
      <div style={{ borderTop: "1px solid var(--rule)", padding: "10px 14px 12px" }}>
        <span className="label">settle(deal)</span>
        {s ? (
          <div className="mono" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
            <div><span className={`tag ${s.live ? "" : "mock"}`}>{s.live ? `live / ${s.mode}` : "mock / no money moved"}</span></div>
            <div>session <span className="muted">{s.sessionId}</span></div>
            <div>cap per-tx = total = <span style={{ color: "var(--ink)" }}>{s.cap}</span> USDC</div>
            <div>payment <span style={{ color: "var(--ink)" }}>{s.code}</span></div>
            <div>{s.live && s.explorer ? <a href={s.explorer} target="_blank" rel="noreferrer">tx {s.ref}</a> : <>ref <span className="muted">{s.ref}</span> (mock ref, not a chain tx)</>}</div>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>{t.status === "no-deal" || t.status === "stopped" ? "Not called. No deal, nothing paid." : "Runs once the referee closes the deal: a one-off Kite-style session capped at exactly the agreed total."}</p>
        )}
      </div>
    </div>
  );
}

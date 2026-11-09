"use client";
import { motion } from "motion/react";
import type { LogEntry } from "@/lib/chain";
import { describe } from "@/lib/view";
import type { EntryAudit } from "@/lib/verify";

const QUIET = new Set(["prompt", "response"]);

export function LogView({ entries, brokenAt = null, showQuiet = false, max, audit }: { entries: LogEntry[]; brokenAt?: number | null; showQuiet?: boolean; max?: number; audit?: EntryAudit[] }) {
  const list = entries.filter((e) => showQuiet || !QUIET.has(e.kind));
  const shown = max ? list.slice(-max) : list;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 14 }}>
      {shown.map((e) => {
        const blocked = e.kind === "offer.blocked" || (e.kind === "offer.rejected" && !!e.payload.attack);
        const au = audit?.[e.seq];
        const bad = !!au && (au.hash !== "ok" || au.rule === "fail");
        const broken = brokenAt !== null && e.seq >= brokenAt;
        const first = brokenAt === e.seq;
        return (
          <motion.li key={e.seq} data-seq={e.seq} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
            style={{
              display: "grid", gridTemplateColumns: audit ? "44px 1fr 92px" : "44px 1fr", gap: 10, padding: "8px 10px", borderBottom: "1px solid var(--rule)",
              background: first ? "rgba(126,179,247,.16)" : blocked ? "var(--wax-soft)" : "transparent",
              borderLeft: blocked || first ? "3px solid var(--wax)" : "3px solid transparent",
              opacity: broken && !first ? 0.55 : 1,
            }}>
            <span className="mono" style={{ color: blocked || first ? "var(--wax)" : "var(--dim)" }}>{String(e.seq).padStart(3, "0")}</span>
            <span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: blocked ? "var(--wax)" : "var(--muted)" }}>{blocked ? "flag / " : ""}{e.kind}{e.payload.attack ? (e.payload.simulated ? " / simulated attack" : " / attack") : ""}</span>
              <span style={{ display: "block", color: blocked ? "var(--wax)" : "var(--ink)", wordBreak: "break-word" }}>{describe(e)}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>{first ? "hash no longer matches: " : ""}{e.hash.slice(0, 20)}...{au && au.rule !== null && au.note ? ` · ${au.note}` : ""}</span>
            </span>
            {au && (
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".1em", textAlign: "right", lineHeight: 1.9, color: bad ? "var(--wax)" : "var(--muted)" }} title={au.note}>
                <span style={{ display: "block" }}><i className={au.hash === "ok" ? "ok-dot" : "bad-dot"} /> HASH {au.hash === "ok" ? "OK" : "FAIL"}</span>
                {au.rule !== null && <span style={{ display: "block" }}><i className={au.rule === "ok" ? "ok-dot" : "bad-dot"} /> RULE {au.rule === "ok" ? "OK" : "FAIL"}</span>}
              </span>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
}

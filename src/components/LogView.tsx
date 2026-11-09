"use client";
import { motion } from "motion/react";
import type { LogEntry } from "@/lib/chain";
import { describe } from "@/lib/view";

const QUIET = new Set(["prompt", "response"]);

export function LogView({ entries, brokenAt = null, showQuiet = false, max }: { entries: LogEntry[]; brokenAt?: number | null; showQuiet?: boolean; max?: number }) {
  const list = entries.filter((e) => showQuiet || !QUIET.has(e.kind));
  const shown = max ? list.slice(-max) : list;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 14 }}>
      {shown.map((e) => {
        const blocked = e.kind === "offer.blocked";
        const broken = brokenAt !== null && e.seq >= brokenAt;
        const first = brokenAt === e.seq;
        return (
          <motion.li key={e.seq} data-seq={e.seq} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 26 }}
            style={{
              display: "grid", gridTemplateColumns: "44px 1fr", gap: 10, padding: "8px 10px", borderBottom: "1px solid var(--rule)",
              background: first ? "rgba(179,54,29,.16)" : blocked ? "var(--wax-soft)" : "transparent",
              borderLeft: blocked || first ? "3px solid var(--wax)" : "3px solid transparent",
              opacity: broken && !first ? 0.55 : 1,
            }}>
            <span className="mono muted">#{e.seq}</span>
            <span>
              <span className="mono" style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: blocked ? "var(--wax)" : "var(--muted)" }}>{e.kind}{e.payload.attack ? " · attack" : ""}</span>
              <span style={{ display: "block", color: blocked ? "var(--wax)" : "var(--ink)", wordBreak: "break-word" }}>{describe(e)}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>{first ? "hash no longer matches: " : ""}{e.hash.slice(0, 20)}...</span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

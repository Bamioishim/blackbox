"use client";
import { motion } from "motion/react";
import type { Check } from "@/lib/verify";
import { Mark } from "./Seal";

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {checks.map((c, i) => (
        <motion.li key={c.id + String(c.ok)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 220, damping: 24, delay: i * 0.05 }}
          style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--rule)" }}>
          <span style={{ paddingTop: 3 }}><Mark ok={c.ok} /></span>
          <span>
            <span style={{ fontWeight: 500, color: c.ok === false ? "var(--wax)" : "var(--ink)" }}>{c.label}</span>
            <span className="mono muted" style={{ display: "block", fontSize: 12.5, wordBreak: "break-all" }}>{c.detail}</span>
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

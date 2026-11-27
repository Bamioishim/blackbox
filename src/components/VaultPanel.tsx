"use client";
import { useEffect, useState } from "react";

type Entry = { at: string; path: string; purpose: string; source: "1claw" | "memory" | "denied" | "error"; status?: number; note?: string };
type Log = { entries: Entry[]; callsThisMonth: number; cap: number; configured: boolean; paths: string[] };

const SOURCE_LABEL: Record<Entry["source"], string> = {
  "1claw": "fetched from 1Claw",
  memory: "reused from memory",
  denied: "refused (budget)",
  error: "refused by 1Claw",
};

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " · " + d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "Secured by 1Claw": which secret the agents asked the vault for, and when. Never shows a value. */
export function VaultPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [log, setLog] = useState<Log | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/vault/log", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live) setLog(j); }).catch(() => {});
    return () => { live = false; };
  }, [refreshKey]);
  const entries = log?.entries ?? [];
  const shown = open ? entries : entries.slice(0, 4);
  return (
    <div className="panel vault-panel" style={{ marginTop: 14 }}>
      <div className="panel-head hud" style={{ padding: "0 14px" }}>
        <span>Field report 00 / <b>secrets</b></span>
        <span className="wax">Secured by 1Claw</span>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          The agents hold no keys. The SERV key, both Kite agent signing keys and the anchor wallet key live in a 1Claw vault and are released just in time, one path at a time. Values never reach this page or the logs.
        </p>
        {!log ? (
          <div className="mono muted">loading access log…</div>
        ) : !log.configured ? (
          <div className="mono muted">1Claw is not configured on this deployment.</div>
        ) : entries.length === 0 ? (
          <div className="mono muted">No secret has been fetched yet. Start a deal and watch the vault release keys.</div>
        ) : (
          <ul className="vault-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((e, i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 12px", padding: "8px 0", borderTop: i ? "1px solid var(--rule)" : 0 }}>
                <span className="mono" style={{ wordBreak: "break-all", fontSize: 12.5 }}>{e.path}</span>
                <span className={`tag ${e.source === "1claw" ? "mock" : ""}`} style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{SOURCE_LABEL[e.source]}</span>
                <span className="muted" style={{ fontSize: 12 }}>{e.purpose}{e.note && e.source !== "memory" ? ` · ${e.note}` : ""}</span>
                <span className="mono muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <span className="mono muted" style={{ fontSize: 11.5 }}>{log ? `${log.callsThisMonth}/${log.cap} vault calls this month` : ""}</span>
          {entries.length > 4 && (
            <button type="button" className="btn" style={{ padding: "10px 14px", minHeight: 44 }} onClick={() => setOpen(!open)}>{open ? "Show less" : `Show all ${entries.length}`}</button>
          )}
        </div>
      </div>
    </div>
  );
}

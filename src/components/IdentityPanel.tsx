"use client";
import { KITE_OWNER, KITE_AGENTS, short } from "@/lib/identity";
import type { AgentSeat } from "@/lib/view";

/** Who is at the table: the Kite Passport owner and each registered Kite agent with its signing key. */
export function IdentityPanel({ agents, sessionId }: { agents: AgentSeat[]; sessionId?: string }) {
  const a = (side: string) => agents.find((x) => x.side === side);
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div className="panel-head hud" style={{ padding: "0 14px" }}><span>Field report 01 / <b>identity</b></span><span>Kite Passport</span></div>
      <div className="id-grid">
        <div>
          <span className="label">Owner (Kite Passport)</span>
          <div className="mono" style={{ marginTop: 4 }}>{KITE_OWNER.account}</div>
          <div className="mono muted">EVM {short(KITE_OWNER.wallet.evm, 8, 6)}</div>
          <div className="mono muted">SOL {short(KITE_OWNER.wallet.solana, 6, 6)}</div>
          {sessionId && <div className="mono muted">session {sessionId}</div>}
        </div>
        {(["buyer", "seller"] as const).map((side) => (
          <div key={side}>
            <span className="label">{side} agent (registered Kite DID)</span>
            <div className="mono" style={{ marginTop: 4, wordBreak: "break-all" }}>{a(side)?.did ?? KITE_AGENTS[side].did}</div>
            <div className="mono muted" style={{ wordBreak: "break-all" }}>{a(side)?.agentId ?? KITE_AGENTS[side].agentId}</div>
            <div className="mono muted">{a(side) ? <>key {a(side)!.runtimeKey}</> : <>registered key {short(KITE_AGENTS[side].runtimeKey, 8, 6)}</>}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Signs every offer it makes. {a(side) ? (a(side)!.localKeyMatch ? "Local key matches the registered runtime address; active Kite Passport binding is unverified." : a(side)!.did ? "Per-deal key, not the DID's registered runtime key." : "Not bound to a Kite agent DID.") : "Registered DID metadata; no live Passport runtime connection is verified here."}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

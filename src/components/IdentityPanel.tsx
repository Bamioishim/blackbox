"use client";
import { KITE_OWNER, short } from "@/lib/identity";

type A = { side: string; runtimeKey: string; agentRef: string };

/** Who is at the table: the Kite Passport owner and each agent's own signing key. */
export function IdentityPanel({ agents, sessionId }: { agents: A[]; sessionId?: string }) {
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
            <span className="label">{side} agent</span>
            <div className="mono" style={{ marginTop: 4 }}>{a(side)?.agentRef ?? `blackbox-${side}`}</div>
            <div className="mono muted">{a(side) ? <>key {a(side)!.runtimeKey}</> : "runtime key minted when the deal starts"}</div>
            <div className="muted" style={{ fontSize: 12 }}>Signs every offer it makes. Not yet bound to a Kite agent DID.</div>
          </div>
        ))}
      </div>
    </div>
  );
}

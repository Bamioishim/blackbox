"use client";
import Link from "next/link";
import type { Receipt } from "@/lib/receipt";
import { Seal } from "./Seal";
import { CopyHash } from "./CopyHash";
import { KITE_OWNER } from "@/lib/identity";

function Row({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv-row" style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "7px 0", borderBottom: "1px dashed var(--rule)", fontSize: 14 }}>
      <span className="muted">{k}</span>
      <span className={mono ? "mono" : ""} style={{ wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}

export function ReceiptCard({ r }: { r: Receipt }) {
  const s = r.settlement;
  const download = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${r.dealId}.json`;
    a.click();
  };
  return (
    <section style={{ padding: "26px 26px 20px" }} className="panel">
      <div style={{ position: "absolute", top: -18, right: 22 }}><Seal size={44} /></div>
      <p className="hud" style={{ margin: 0 }}>Field report / <b>receipt</b></p>
      <h3 className="display" style={{ fontSize: 40, margin: "6px 0 14px" }}>
        {r.outcome.status === "closed" ? <>{r.outcome.unitPrice} <span className="muted" style={{ fontSize: 22 }}>USDC per unit</span></> : "No deal"}
      </h3>
      <Row k="Deal" v={r.dealId} />
      <Row k="Terms" v={`${r.terms.quantity} ${r.terms.item}`} mono={false} />
      {r.outcome.status === "closed" && <Row k="Total" v={`${r.outcome.total} USDC, closed in round ${r.outcome.round}`} />}
      {r.budget && <Row k="Your limit" v={`${r.budget.limit} USDC (set before any offer, caps Kite session ${r.budget.sessionId})`} />}
      <Row k="Owner" v={`Kite Passport ${r.identity?.owner.account ?? KITE_OWNER.account} · payer ${r.identity?.owner.wallet.evm ?? KITE_OWNER.wallet.evm}`} />
      {r.identity?.agents.map((a) => <Row key={a.side} k={`${a.side} agent`} v={<>{a.agentRef} · {a.runtimeKey}<br /><span className="muted" style={{ fontFamily: "var(--font-geist-sans)" }}>signs every offer; not yet bound to a Kite agent DID</span></>} />)}
      {s && (
        <>
          {!s.live && <div className="sim-banner" role="status" style={{ marginTop: 12 }}>SIMULATED — no real funds moved{s.fallback ? ` (fallback: ${s.fallback.reason})` : ""}</div>}
          <Row k="Settlement" v={<><span className="tag mock">{s.live ? s.mode : "simulated"}</span> <span style={{ fontFamily: "var(--font-geist-sans)" }}>{s.label}</span></>} />
          <Row k="Session" v={s.session.sessionId} />
          <Row k="Caps" v={`per payment ${s.session.maxAmountPerTx} · total ${s.session.maxTotalAmount} ${s.session.asset}${s.session.capSource === "user-budget" ? " (= your limit)" : " (= deal total)"}`} />
          <Row k="Expires" v={`${s.session.expiresAt} (${Math.round(s.session.ttlSeconds / 60)} min)`} />
          <Row k="Delegation" v={<>{s.delegation.signer}<br /><span className="muted">{s.delegation.signature.slice(0, 42)}...</span></>} />
          <Row k="Payment" v={s.live && s.payment.ref ? `${s.payment.amount} USDC · ${s.payment.code} · tx ${s.payment.ref}` : `${s.payment.amount} USDC · ${s.payment.code}${s.payment.ref ? ` · simulation ref ${s.payment.ref} (not a transaction)` : ""}`} />
          {s.enforcement.map((e) => <Row key={e.label} k="Rail check" v={`${e.label}: refused, ${e.code}${e.rule ? ` (${e.rule})` : ""}`} />)}
        </>
      )}
      <Row k="Final hash" v={<CopyHash value={r.finalHash} label="final hash" />} />
      <Row k="Anchor" v={r.anchor.status === "anchored" ? <a href={r.anchor.explorerUrl}>{r.anchor.txHash}</a> : "not anchored yet"} />
      <Row k="Referee" v={<CopyHash value={r.referee.hash} label="referee hash" />} />
      <pre className="snippet" style={{ marginTop: 16 }}><b>npm run verify -- </b>{r.dealId}.json --entries</pre>
      <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <Link className="btn primary" href={`/verify?id=${r.dealId}`}><span>Verify this deal</span><span className="arrow">&rarr;</span></Link>
        <button className="btn" onClick={download}>Download receipt</button>
      </div>
    </section>
  );
}

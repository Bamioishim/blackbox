"use client";

export type DealSettlement = {
  id: string;
  status: "pending_deal" | "requested" | "awaiting_approval" | "settled" | "failed" | "cancelled";
  chain: "solana-mainnet";
  asset: "USDC";
  amount: string | null;
  recipient: string;
  approvalUrl: string | null;
  approvalExpiresAt: string | null;
  signature: string | null;
  explorerUrl: string | null;
  onchain: { sender?: string; slot?: number; blockTime?: number; kiteRequestId?: string } | null;
  error: string | null;
  settledAt: string | null;
};

const short = (v: string) => (v.length > 16 ? `${v.slice(0, 6)}…${v.slice(-6)}` : v);
const amt = (v: string | null) => (v ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "");
function wat(ts?: number | string | null) {
  if (!ts) return "";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " WAT";
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row" style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 12, padding: "6px 0", borderBottom: "1px dashed var(--rule)", fontSize: 13.5 }}>
      <span className="muted">{k}</span>
      <span className="mono" style={{ wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}

/** Settlement state for a marketplace deal that asked for a real Kite Passport payment. */
export function RealDealSettlement({ s, role, dealStatus }: { s: DealSettlement; role: "buyer" | "seller"; dealStatus: string }) {
  const pay = `${amt(s.amount)} USDC`;
  if (s.status === "settled") {
    return (
      <div className="real-settlement-card" style={{ marginTop: 8 }}>
        <div className="live-banner" role="status">Settled · {pay} paid on Solana mainnet via Kite Passport</div>
        <Row k="Paid" v={`${pay} → ${short(s.recipient)}`} />
        {s.onchain?.sender && <Row k="From" v={short(s.onchain.sender)} />}
        <Row k="Transaction" v={s.explorerUrl ? <a href={s.explorerUrl} target="_blank" rel="noreferrer">{short(s.signature ?? "")} · view on Solscan ↗</a> : "—"} />
        {s.onchain?.blockTime ? <Row k="Confirmed" v={wat(s.onchain.blockTime)} /> : null}
        <Row k="Asset" v={role === "buyer" ? "Delivered to your portfolio" : "Transferred to the buyer"} />
        <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>Checked on Solana mainnet before this deal was marked settled: the exact agreed USDC reached the seller's payout address.</p>
      </div>
    );
  }
  if (s.status === "pending_deal") {
    if (dealStatus === "No deal" || dealStatus === "Failed") return null;
    return <p className="hud" style={{ margin: "6px 0" }}>Real settlement armed · a USDC payment is requested only if the agents agree</p>;
  }
  if (s.status === "requested" || s.status === "awaiting_approval") {
    return (
      <div className="real-settlement-card" style={{ marginTop: 8 }}>
        <div className="live-banner" role="status" style={{ animation: "none" }}>Real payment requested · {pay} on Solana mainnet</div>
        <Row k="Pay to" v={s.recipient} />
        {s.status === "awaiting_approval" && role === "buyer" && s.approvalUrl ? (
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a className="btn primary" href={s.approvalUrl} target="_blank" rel="noreferrer" style={{ color: "#121212", textDecoration: "none" }}><span>Approve {pay} in Kite Passport</span><span className="arrow">&rarr;</span></a>
            <span className="muted" style={{ fontSize: 13 }}>Opens Kite Passport. Approve with your passkey; this deal updates by itself.</span>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
            {s.status === "awaiting_approval" ? "Waiting for the buyer to approve the payment with their Kite Passport passkey." : "Preparing the Kite Passport payment request…"}
          </p>
        )}
      </div>
    );
  }
  return <p className="muted" style={{ margin: "6px 0", fontSize: 13 }}>Real payment {s.status === "failed" ? "did not go through" : "not made"}{s.error ? `: ${s.error}` : "."} No funds moved.</p>;
}

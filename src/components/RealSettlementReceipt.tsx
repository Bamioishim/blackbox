import { KITE_SOLANA_USDC_SETTLEMENT, REAL_SETTLEMENT_LABEL } from "@/lib/real-settlement";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row" style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "7px 0", borderBottom: "1px dashed var(--rule)", fontSize: 14 }}>
      <span className="muted">{k}</span>
      <span className="mono" style={{ wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}

/** Recorded, verified 1 USDC transfer. Never used for mock settle(deal) output. */
export function RealSettlementReceipt({ compact = false }: { compact?: boolean }) {
  const s = KITE_SOLANA_USDC_SETTLEMENT;
  return (
    <section id="real-settlement" className="panel real-settlement-card" style={{ padding: compact ? "18px 18px 14px" : "26px 26px 20px", position: "relative" }}>
      <div className="live-banner" role="status">{REAL_SETTLEMENT_LABEL}</div>
      <p className="hud" style={{ margin: compact ? "10px 0 0" : "12px 0 0" }}>Field report / <b>live rail</b></p>
      <h3 className="display" style={{ fontSize: compact ? 28 : 40, margin: "6px 0 14px" }}>
        {s.amount} <span className="muted" style={{ fontSize: compact ? 16 : 22 }}>USDC</span>
      </h3>
      <Row k="Amount" v={`${s.amount} USDC`} />
      <Row k="From" v={s.from} />
      <Row k="To" v={s.to} />
      <Row k="Time" v={`${s.settledAtWat} (Africa/Lagos)`} />
      <Row k="Kite request" v={s.kiteRequestId} />
      <Row k="Solscan" v={<a href={s.explorerUrl} target="_blank" rel="noreferrer">{s.signature}</a>} />
      {!compact && (
        <>
          <Row k="Chain" v="Solana mainnet" />
          <Row k="Mint" v={s.mint} />
          <Row k="Slot" v={String(s.slot)} />
        </>
      )}
      <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0", lineHeight: 1.55 }}>{s.note}</p>
    </section>
  );
}

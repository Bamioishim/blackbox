"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import type { Receipt } from "@/lib/receipt";
import { verifyReceipt, type Check } from "@/lib/verify";
import { verifyChain } from "@/lib/chain";
import { chartData, listLocal, loadReceipt } from "@/lib/view";
import { REFEREE_HASH } from "@/lib/referee-hash.generated";
import { OfferChart } from "@/components/OfferChart";
import { LogView } from "@/components/LogView";
import { Checks } from "@/components/Checks";
import { Mark } from "@/components/Seal";

function tamper(r: Receipt): { r: Receipt; note: string } {
  const t: Receipt = structuredClone(r);
  const closeIdx = t.log.findIndex((e) => e.kind === "deal.closed");
  const end = closeIdx === -1 ? t.log.length : closeIdx;
  let i = -1;
  for (let k = end - 1; k >= 0; k--) if (t.log[k].kind === "offer.accepted" && t.log[k].payload.side === "buyer") { i = k; break; }
  if (i === -1) return { r: t, note: "Nothing to tamper with." };
  const p = t.log[i].payload as { price: number };
  const before = p.price;
  p.price = Math.round(before * 0.95 * 1e4) / 1e4;
  return { r: t, note: `Edited entry #${i}: the buyer's bid changed from ${before} to ${p.price}, without touching any hash.` };
}

export function Verifier() {
  const params = useSearchParams();
  const [id, setId] = useState(params.get("id") ?? "");
  const [text, setText] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tampered, setTampered] = useState(false);
  const [checked, setChecked] = useState<{ for: unknown; checks: Check[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ id: string; label: string }[]>([]);
  const [local, setLocal] = useState<string[]>([]);

  useEffect(() => {
    fetch("/deals/index.json").then((r) => (r.ok ? r.json() : [])).then(setSamples).catch(() => {});
    queueMicrotask(() => setLocal(listLocal()));
    const q = params.get("id");
    if (q) load(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(dealId: string) {
    setErr(null); setTampered(false);
    const r = await loadReceipt(dealId.trim());
    if (!r) { setErr(`No receipt found for ${dealId}. Paste the receipt JSON instead.`); setReceipt(null); return; }
    setId(dealId.trim()); setReceipt(r); setText("");
  }
  function fromText() {
    setErr(null); setTampered(false);
    try { const r = JSON.parse(text) as Receipt; if (!Array.isArray(r.log)) throw new Error("That JSON has no log."); setReceipt(r); setId(r.dealId ?? ""); }
    catch (e) { setErr(`Couldn't read that receipt: ${(e as Error).message}`); }
  }

  const effective = useMemo(() => (receipt ? (tampered ? tamper(receipt) : { r: receipt, note: "" }) : null), [receipt, tampered]);
  useEffect(() => {
    let live = true;
    if (effective) verifyReceipt(effective.r, undefined, { onchain: true }).then((c) => { if (live) setChecked({ for: effective, checks: c }); });
    return () => { live = false; };
  }, [effective]);
  const checks = checked && checked.for === effective ? checked.checks : null;

  const chain = effective ? verifyChain(effective.r.log) : null;
  const logBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = logBox.current;
    if (!box) return;
    const el = chain?.brokenAt != null ? box.querySelector<HTMLElement>(`[data-seq="${chain.brokenAt}"]`) : null;
    box.scrollTo({ top: el ? el.offsetTop - box.offsetTop - 80 : 0, behavior: "smooth" });
  }, [chain?.brokenAt, effective]);
  const failed = checks?.some((c) => c.ok === false);
  const chart = effective ? chartData(effective.r.log) : null;

  return (
    <main style={{ paddingTop: 48 }}>
      <p className="hud wax">(03) Public verifier / no account</p>
      <h1 className="display" style={{ fontSize: "clamp(42px, 6vw, 76px)", margin: "8px 0 14px", maxWidth: 940 }}>Check a deal <span className="dim">without trusting us.</span></h1>
      <p className="muted" style={{ maxWidth: 700, marginTop: 0 }}>
        Paste a deal ID or a receipt. Your browser re-hashes every log entry, re-runs the referee on the recorded offers,
        checks both revealed limits against their commitments, and reads the payment caps. No account, nothing sent to a server.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 32, marginTop: 34 }} className="v-grid">
        <div>
          <span className="label">Deal ID</span>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <input value={id} placeholder="deal_..." onChange={(e) => setId(e.target.value)} />
            <button className="btn" onClick={() => load(id)}>Load</button>
          </div>
          {(samples.length > 0 || local.length > 0) && (
            <p style={{ fontSize: 14, marginTop: 10 }}>
              <span className="muted">Recorded deals: </span>
              {[...samples.map((s) => ({ id: s.id, label: s.label })), ...local.filter((l) => !samples.some((s) => s.id === l)).map((l) => ({ id: l, label: `${l} (this browser)` }))].map((s, i) => (
                <span key={s.id}>{i ? " · " : ""}<a href="#" onClick={(e) => { e.preventDefault(); load(s.id); }}>{s.label}</a></span>
              ))}
            </p>
          )}
        </div>
        <div>
          <span className="label">Or paste receipt JSON</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"version":"blackbox/1", ...}' style={{ marginTop: 6 }} />
          <button className="btn" style={{ marginTop: 8 }} onClick={fromText} disabled={!text.trim()}>Verify pasted receipt</button>
        </div>
      </div>
      {err && <p className="wax">{err}</p>}

      <AnimatePresence mode="wait">
        {effective && (
          <motion.section key={effective.r.dealId} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 22 }} style={{ marginTop: 50 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap", borderTop: "1px solid var(--rule-2)", paddingTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ transform: "scale(1.6)", display: "inline-flex" }}><Mark ok={checks ? !failed : null} /></span>
                <h2 className="display" style={{ fontSize: 38, margin: 0, color: failed ? "var(--wax)" : "var(--ink)" }}>
                  {!checks ? "Checking..." : failed ? (chain && !chain.ok ? `Broken at entry #${chain.brokenAt}` : "Checks failed") : "Record holds up"}
                </h2>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 14px", border: `1px solid ${tampered ? "var(--wax)" : "var(--rule-2)"}` }}>
                <input type="checkbox" checked={tampered} onChange={(e) => setTampered(e.target.checked)} style={{ width: 16 }} />
                <span><b className="hud" style={{ color: "var(--ink)" }}>Tamper demo</b> <span className="muted" style={{ fontSize: 14 }}>Quietly edit one offer.</span></span>
              </label>
            </div>
            {tampered && <p className="wax" style={{ marginTop: 10 }}>{effective.note}</p>}
            {effective.r.example?.tampered && (
              <p style={{ marginTop: 10, padding: "10px 14px", border: "1px solid var(--wax)", background: "var(--wax-soft)" }}>
                <span className="tag mock">Tampered example</span> <span>{effective.r.example.note}</span>
              </p>
            )}
            <p className="mono muted" style={{ fontSize: 12.5 }}>{effective.r.dealId} · {effective.r.model} · recorded {effective.r.createdAt} · this site&apos;s referee {REFEREE_HASH.slice(0, 16)}...</p>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.25fr) minmax(0,1fr)", gap: 40, marginTop: 20 }} className="v-grid">
              <div>
                {chart && <OfferChart rounds={chart.rounds} maxRounds={chart.maxRounds} reveal={chart.reveal} price={chart.price} closedRound={chart.closedRound} blockedRounds={chart.blockedRounds} />}
                <div className="panel" style={{ marginTop: 30 }}>
                  <div className="panel-head hud"><span>Field report 02 / <b>hash-chained log</b></span><span className={chain && !chain.ok ? "wax" : ""}>{effective.r.log.length} entries{chain && !chain.ok ? ` / broken at #${chain.brokenAt}` : " / chain intact"}</span></div>
                  <div ref={logBox} style={{ maxHeight: 520, overflow: "auto", position: "relative" }} data-lenis-prevent>
                    <LogView entries={effective.r.log} brokenAt={chain?.brokenAt ?? null} />
                  </div>
                </div>
              </div>
              <div>
                {checks && (
                  <div className="panel">
                    <div className="panel-head hud"><span>Field report 01 / <b>checks</b></span><span className={failed ? "wax" : ""}>{checks.filter((c) => c.ok).length} / {checks.length} pass{failed ? ` / ${checks.filter((c) => c.ok === false).length} flagged` : ""}{checks.some((c) => c.ok === null) ? ` / ${checks.filter((c) => c.ok === null).length} pending` : ""}</span></div>
                    <div className="panel-body"><Checks checks={checks} /></div>
                  </div>
                )}
                {effective.r.anchor.status !== "anchored" && (
                  <p className="muted" style={{ fontSize: 14, marginTop: 16 }}>
                    Without an onchain anchor, this check proves the log is internally consistent, not that it wasn&apos;t rewritten whole before you got it. Anchoring the final hash fixes that; it&apos;s built and waiting for approval to deploy.
                  </p>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <style>{`@media (max-width: 900px) { .v-grid { grid-template-columns: 1fr !important; } }`}</style>
    </main>
  );
}

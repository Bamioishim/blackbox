import Link from "next/link";
import { heroReceipt } from "@/lib/samples";
import { auditEntries } from "@/lib/verify";
import { decisions } from "@/lib/view";
import { REFEREE_HASH, REFEREE_FILES } from "@/lib/referee-hash.generated";
import { PointCloud } from "@/components/PointCloud";
import { RefusalScene } from "@/components/RefusalScene";
import { Ticket } from "@/components/Ticket";
import { Reveal } from "@/components/Reveal";

const STEPS = [
  ["Seal the limits", "Before a single offer, each side commits to sha256(limit + salt). The number stays private; the commitment goes into the log."],
  ["Haggle in sealed rounds", "Each owner's agent runs on SERV Reasoning with only its owner's goals in its prompt. It sees past prices, never the other side's words. Its reasoning goes to its owner and nowhere else."],
  ["A referee, not a model", "Plain deterministic code sits between the agents. It accepts exactly {price, quantity, round}. Anything else is dropped and logged as blocked: non-schema content. An agent can't leak what the table won't carry."],
  ["Close at the crossing", "When the buyer's bid meets the seller's ask, the referee closes the deal at the midpoint. No retreating offers, no extra rounds."],
  ["Reveal and check", "Both sides reveal limit and salt. Anyone can hash them, match the commitments, and see that the price sits inside both limits."],
  ["Pay through a capped session", "Settlement opens a one-off Kite Passport-style session: per-payment cap and total cap both equal the agreed amount, ten-minute expiry. The rail refuses anything more. In this build the payment is a mock."],
];

const STATUS: [string, string, string][] = [
  ["Live", "Both agents negotiate on SERV Reasoning", "Real model calls, structured output, every prompt and reply hashed into the log."],
  ["Live", "Referee, commit-reveal, hash chain, verifier", "Deterministic, tested, and re-runnable in your browser on any receipt."],
  ["Mock", "Payment through Kite Passport", "Same session shape and refusal codes as Kite's docs, signed by a throwaway key. No money moves. The real adapter is sketched in the repo."],
  ["Not yet", "Onchain anchor of the final hash", "The contract is written. Deploying it needs approval and a little gas on Kite's chain."],
];

const QA: [string, string][] = [
  ["Couldn't the log be rewritten before it's anchored?", "Yes, up to the moment of anchoring. That's what the anchor is for: once the final hash is onchain, every earlier entry is fixed, because changing any of them changes the final hash. Until this build anchors, the verifier proves the log is internally consistent, not that nobody swapped the whole thing."],
  ["Couldn't buyer and seller collude to fake a log?", "The record proves the log wasn't altered after anchoring. It does not prove the two parties didn't stage the whole negotiation together. What helps: the referee's code is published with its hash, so anyone can re-run it on the recorded offers and get the same result, and the commitments pin each limit before the first offer."],
  ["Why a chain at all?", "Dispute evidence has to live somewhere neither party controls. If our database is the only copy, we're the referee. One hash write on Kite's EVM chain is enough; the rest of the record can live anywhere."],
  ["Who pays 0.3%?", "Whoever wants a deal they can defend later: marketplaces running agent-to-agent trades, OTC-style token deals, and companies whose procurement agents buy from other agents. The bigger business is the recorder on its own, sold as an audit log for any company running agents."],
  ["What stops an agent from offering past its own limit?", "A guard on the owner's side checks every offer against that owner's own limit before it reaches the table, and asks the agent again if it slips. Because both offers sit inside their owners' limits, a crossing price always does too."],
];

export default function Home() {
  const r = heroReceipt();
  const attacks = r ? r.log.filter((e) => (e.kind === "offer.blocked" || e.kind === "offer.rejected") && e.payload.attack) : [];
  const closed = r?.outcome.status === "closed" ? r.outcome : null;
  const audit = r ? auditEntries(r.log) : [];
  const ruleChecks = audit.filter((a) => a.rule !== null).length;
  const ds = r ? decisions(r.log) : [];
  return (
    <main>
      <section className="hero" style={{ position: "relative", minHeight: "min(760px, calc(100vh - 140px))", display: "grid", gridTemplateColumns: "minmax(0, 0.82fr) minmax(0, 1.18fr)", alignItems: "center", gap: 20 }}>
        <div style={{ position: "absolute", top: 22, left: 0, right: 0, display: "flex", justifyContent: "space-between", pointerEvents: "none", zIndex: 2 }}>
          <div className="figlabel">Fig. 01 / {r ? r.dealId : "no deal"} / point cloud<span>Local grid / price × round</span></div>
          <div className="figlabel" style={{ textAlign: "right" }}>{closed ? `R ${closed.round} / P ${closed.unitPrice}` : "R - / P -"}<span>{r ? `${r.log.length} entries / ${attacks.length} flagged` : ""}</span></div>
        </div>
        <div style={{ position: "relative", zIndex: 2, paddingTop: 60 }}>
          <p className="hud wax">(01) Negotiate / verify / referee</p>
          <h1 className="display" style={{ fontSize: "clamp(40px, 4.4vw, 66px)", margin: "16px 0 22px" }}>
            The ground truth <span className="dim" style={{ display: "block" }}>for every agent deal.</span>
          </h1>
          <p style={{ fontSize: 16.5, maxWidth: 440, color: "var(--ink-2)" }}>
            Two SERV agents haggle over a real transaction. Neither sees the other&apos;s limit. Plain code referees every offer,
            and the whole record replays in your browser.
          </p>
          <div style={{ display: "flex", gap: 26, marginTop: 30, flexWrap: "wrap", alignItems: "center" }}>
            <Link href="/deal" className="btn primary"><span>Open a deal</span><span className="arrow">&rarr;</span></Link>
            <Link href={r ? `/verify?id=${r.dealId}` : "/verify"} className="link-hud">Verify a recorded deal ↗</Link>
          </div>
        </div>
        <div style={{ position: "relative", height: "min(700px, calc(100vh - 160px))", minHeight: 460, marginRight: -40 }}>
          {r && <PointCloud receipt={r} />}
          <span className="hud" style={{ position: "absolute", right: 40, bottom: 10, fontSize: 10 }}>Drag to orbit / real SERV run</span>
        </div>
      </section>

      <Reveal as="section" style={{ paddingTop: 80 }}>
        <p className="hud" data-reveal>(02) Three proofs, not three claims</p>
        <div className="proofs" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", borderTop: "1px solid var(--rule)", marginTop: 14 }}>
          {[
            ["Decisions move money", `Each agent decision (open, counter, accept, walk) moves a transaction ticket. This run: ${ds.length} decisions, ending ${closed ? `at ${closed.total} USDC through settle(deal)` : "with no deal"}. Payment is a labelled mock.`, "/deal", "Watch a live deal"],
            ["Judges verify, not trust", `Drop any receipt into the verifier: it re-hashes ${audit.length} entries, re-runs the referee on ${ruleChecks} of them, and checks both sealed limits. Or run npm run verify offline.`, r ? `/verify?id=${r.dealId}` : "/verify", "Verify this deal"],
            ["Rule-breaks get stopped", `${attacks.length} simulated rule-break${attacks.length === 1 ? "" : "s"} in this run, each refused by plain code with the rule shown, while the haggle carries on.`, "#attack", "See the refusals"],
          ].map(([t, d, href, cta], i) => (
            <div key={t} data-reveal style={{ padding: "22px 24px 22px 0", borderRight: i < 2 ? "1px solid var(--rule)" : 0, paddingLeft: i ? 24 : 0 }}>
              <span className="hud wax">Proof 0{i + 1}</span>
              <h3 className="display" style={{ fontSize: 30, margin: "10px 0 10px" }}>{t}</h3>
              <p className="muted" style={{ fontSize: 15, margin: "0 0 14px" }}>{d}</p>
              <Link href={href} className="link-hud">{cta} &rarr;</Link>
            </div>
          ))}
        </div>
      </Reveal>

      {r && (
        <Reveal as="section" style={{ paddingTop: 100 }}>
          <div id="attack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 0.75fr)", gap: 32, scrollMarginTop: 30 }} className="split">
            <div data-reveal>
              <p className="hud">(03) Attack <span className="tag mock" style={{ marginLeft: 8 }}>Simulated</span></p>
              <h2 className="display" style={{ fontSize: 50, margin: "8px 0 12px" }}>An agent breaks a rule. <span className="dim">Code stops it.</span></h2>
              <p className="muted" style={{ maxWidth: 640 }}>
                In attack mode a test harness takes over in round 2: it pushes a prompt injection from the seller&apos;s side and a backwards bid from the buyer&apos;s side.
                The SERV model refused to write the injection itself, so the harness inserts it, and the log says so. The referee refuses both and the negotiation carries on.
              </p>
              {attacks.length ? attacks.map((a, i) => <RefusalScene key={a.seq} log={r.log} entry={a} n={i + 1} />) : <p className="muted">This recorded run has no attack.</p>}
            </div>
            <div data-reveal style={{ paddingTop: 40 }}>
              <Ticket log={r.log} />
            </div>
          </div>
        </Reveal>
      )}

      <Reveal as="section" style={{ paddingTop: 100 }}>
        <div id="how" style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 48 }} className="split">
          <div data-reveal><p className="hud">(04) Method</p><h2 className="display" style={{ fontSize: 52, margin: "10px 0 0" }}>How a deal <span className="dim">runs</span></h2></div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {STEPS.map(([t, d], i) => (
              <li key={t} data-reveal style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 16, padding: "22px 0", borderTop: "1px solid var(--rule)" }}>
                <span className="hud wax" style={{ paddingTop: 6 }}>({String(i + 1).padStart(2, "0")})</span>
                <span><span className="display" style={{ fontSize: 28, display: "block", marginBottom: 6 }}>{t}</span><span className="muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>

      <Reveal as="section" style={{ paddingTop: 110 }}>
        <p className="hud" data-reveal>(05) Status, plainly</p>
        <h2 className="display" data-reveal style={{ fontSize: 52, margin: "10px 0 22px" }}>What&apos;s real <span className="dim">in this build</span></h2>
        <div>
          {STATUS.map(([tag, t, d]) => (
            <div key={t} data-reveal style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 340px) minmax(0, 1fr)", gap: 20, padding: "18px 0", borderTop: "1px solid var(--rule)", alignItems: "baseline" }} className="status-row">
              <span><span className={`tag ${tag !== "Live" ? "mock" : ""}`}>{tag !== "Live" ? "Flag / " : ""}{tag}</span></span>
              <span style={{ color: "var(--ink)" }}>{t}</span>
              <span className="muted">{d}</span>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal as="section" style={{ paddingTop: 110 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 48 }} className="split">
          <div data-reveal><p className="hud">(06) Cross-examination</p><h2 className="display" style={{ fontSize: 52, margin: "10px 0 0" }}>Hard <span className="dim">questions</span></h2></div>
          <div>
            {QA.map(([q, a]) => (
              <details key={q} data-reveal style={{ borderTop: "1px solid var(--rule)", padding: "18px 0" }}>
                <summary style={{ cursor: "pointer", fontSize: 25, listStyle: "none", display: "flex", justifyContent: "space-between", gap: 16 }} className="display">{q}<span className="wax" aria-hidden>+</span></summary>
                <p className="muted" style={{ margin: "10px 0 0", maxWidth: 680 }}>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal as="section" style={{ paddingTop: 110 }}>
        <div data-reveal className="panel" style={{ padding: "18px 20px" }}>
          <p className="hud" style={{ margin: 0 }}>(07) Published referee code</p>
          <p className="mono" style={{ fontSize: "clamp(13px, 1.6vw, 18px)", wordBreak: "break-all", margin: "8px 0" }}>sha256 {REFEREE_HASH}</p>
          <p className="muted" style={{ fontSize: 14 }}>Hash of {REFEREE_FILES.join(" + ")}. Every receipt carries it, and the verifier flags any receipt made by different referee code. Rebuild it with <span className="mono">npm run referee-hash</span>.</p>
        </div>
      </Reveal>
      <style>{`@media (max-width: 900px) { .hero, .split, .proofs { grid-template-columns: 1fr !important; } .proofs > div { border-right: 0 !important; padding-left: 0 !important; } .status-row { grid-template-columns: 1fr !important; gap: 6px !important; } .readouts { grid-auto-flow: row !important; grid-template-columns: 1fr 1fr; } } details summary::-webkit-details-marker { display: none; }`}</style>
    </main>
  );
}

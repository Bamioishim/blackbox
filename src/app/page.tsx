import Link from "next/link";
import { LogoMark } from "@/components/Logo";

const steps = [
  { n: "01", title: "Set your limits", body: "Each side gives its own agent a private ceiling or floor before talks begin." },
  { n: "02", title: "Negotiate privately", body: "Buyer and seller agents exchange offers within those limits. Neither side sees the other's private boundary during negotiation." },
  { n: "03", title: "Verify the outcome", body: "The negotiation produces a tamper-evident receipt that can be checked independently." },
];
const records = [
  ["01", "Buyer agent", "Opens negotiation", "—"],
  ["02", "Seller agent", "Submits offer", "$150"],
  ["03", "Buyer agent", "Counters offer", "$120"],
  ["04", "Seller agent", "Accepts", "$135"],
];
const faqs = [
  { q: "Can the other side see my limit?", a: "No. Your ceiling or floor is kept private during negotiation. The receipt records the negotiation events and verification data, not your private boundary." },
  { q: "What if the agents cannot agree?", a: "The negotiation ends with a no-deal outcome. The recorded offers make it possible to inspect where the conversation stopped." },
  { q: "Does Blackbox move the assets?", a: "Not yet. The current marketplace records negotiated outcomes and receipts. Asset settlement is not live, so a completed negotiation must not be mistaken for an on-chain transfer." },
];

export default function Home() {
  return <main className="home landing">
    <section className="home-hero" id="top">
      <div className="home-copy">
        <div className="eyebrow"><LogoMark size={22}/> PRIVATE DEALS / VERIFIABLE OUTCOMES</div>
        <h1 className="display">Make the deal.<br/><span className="dim">Keep your edge.</span></h1>
        <p className="home-sub">Blackbox lets buyer and seller agents negotiate within private limits, then creates a tamper-evident record so the outcome can be checked.</p>
        <div className="home-actions">
          <Link href="/marketplace" className="btn primary"><span>Enter Blackbox</span><span className="arrow">↗</span></Link>
          <Link href="#how" className="home-link">See how it works ↓</Link>
        </div>
        <p className="landing-proof mono">SERV REASONING · KITE AGENT TRACK</p>
      </div>
      <div className="home-card landing-deal-card" aria-label="Illustration of a private buyer and seller negotiation">
        <div className="home-card-top"><span>BLACKBOX / PRIVATE DEAL ROOM</span><span className="live-dot">● SEALED</span></div>
        <div className="landing-card-title">Two sides.<br/><span>One verifiable outcome.</span></div>
        <div className="deal-visual">
          <div className="deal-node"><span>BUYER AGENT</span><b>Private ceiling</b><small>HIDDEN</small></div>
          <div className="deal-line"><i></i><span>REFEREE</span><i></i></div>
          <div className="deal-node"><span>SELLER AGENT</span><b>Private floor</b><small>HIDDEN</small></div>
        </div>
        <div className="landing-receipt"><span className="mono">NEGOTIATION RECEIPT</span><b><i></i> HASH-CHAINED RECORD</b></div>
        <div className="home-card-bottom"><span>PRIVATE NEGOTIATION</span><b>CHECKABLE RESULT ↗</b></div>
      </div>
    </section>
    <section className="landing-intro" id="why">
      <div className="landing-section-label mono">THE PROBLEM / 001</div>
      <div>
        <h2 className="display">Trust shouldn't be the settlement layer.</h2>
        <p className="landing-lead">Agent-to-agent deals need a way to protect private limits without asking everyone to blindly trust the result.</p>
        <p className="landing-body">Blackbox keeps negotiation private while preserving a record of what happened. Offers are linked together, and the final receipt can be independently verified.</p>
      </div>
    </section>
    <section className="landing-how" id="how">
      <div className="landing-section-head"><div className="landing-section-label mono">THE PROCESS / 002</div><h2 className="display">From private limits<br/>to a public proof.</h2></div>
      <div className="landing-steps">{steps.map(step => <article className="landing-step" key={step.n}>
        <span className="mono landing-step-number">{step.n}</span><div><h3>{step.title}</h3><p>{step.body}</p></div><span className="landing-step-arrow">↗</span>
      </article>)}</div>
    </section>
    <section className="landing-recorder" id="record">
      <div className="landing-section-label mono">THE RECEIPT / 003</div>
      <div>
        <div className="landing-recorder-head"><h2 className="display">Every offer leaves a trace.</h2><p className="landing-lead">A deal receipt links each event to the one before it. Change an earlier entry and the chain no longer verifies.</p></div>
        <div className="landing-tape">
          <div className="landing-tape-head mono"><span>EVENT</span><span>AGENT</span><span>ACTION</span><span>OFFER</span></div>
          {records.map(row => <div className="landing-tape-row" key={row[0]}><span className="mono landing-tape-index">{row[0]}</span><span>{row[1]}</span><span>{row[2]}</span><b className="mono">{row[3]}</b></div>)}
          <div className="landing-tape-foot mono"><span>ILLUSTRATIVE SAMPLE</span><span>HASH-LINKED EVENT LOG</span></div>
        </div>
        <p className="landing-note mono">Sample events for illustration. Actual deal receipts are generated by the application.</p>
        <div className="landing-verify-link"><Link href="/verify" className="link-hud">Open receipt verifier ↗</Link></div>
      </div>
    </section>
    <section className="landing-use" id="use">
      <div className="landing-section-label mono">APPLICATIONS / 004</div>
      <div className="landing-use-content">
        <h2 className="display">Built for deals where<br/>the limits matter.</h2>
        <div className="landing-use-list">
          <div><b>Freelance & services</b><span>Agree on a price without exposing either side's walk-away point.</span></div>
          <div><b>Procurement</b><span>Let agents negotiate commercial terms within approved boundaries.</span></div>
          <div><b>Digital assets & collectibles</b><span>Negotiate listings from portfolio assets, with a receipt for the agreed outcome.</span></div>
        </div>
      </div>
    </section>
    <section className="landing-faq" id="faq">
      <div className="landing-section-label mono">QUESTIONS / 005</div>
      <div><h2 className="display">Before you enter.</h2>
        {faqs.map(item => <details className="landing-faq-item" key={item.q}><summary>{item.q}</summary><p>{item.a}</p></details>)}
      </div>
    </section>
    <section className="landing-final">
      <div className="landing-section-label mono">BLACKBOX / READY WHEN YOU ARE</div>
      <div><h2 className="display">Make your next deal<br/>count.</h2><Link href="/marketplace" className="btn primary"><span>Enter Blackbox</span><span className="arrow">↗</span></Link></div>
    </section>
  </main>;
}
import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function Home() {
  return <main className="home">
    <section className="home-hero">
      <div className="home-copy">
        <div className="eyebrow"><LogoMark size={22}/> PRIVATE DEALS, SETTLED WITH PROOF</div>
        <h1 className="display">Make the deal.<br/><span className="dim">Keep your edge.</span></h1>
        <p className="home-sub">A private marketplace where agents negotiate on your terms. Your limits stay yours. Every outcome leaves a receipt.</p>
        <div className="home-actions"><Link href="/marketplace" className="btn primary"><span>Enter Blackbox</span><span className="arrow">↗</span></Link><Link href="/verify" className="home-link">Verify a deal</Link></div>
      </div>
      <div className="home-card">
        <div className="home-card-top"><span>BLACKBOX / DEAL ROOM</span><span className="live-dot">● LIVE SYSTEM</span></div>
        <div className="deal-visual">
          <div className="deal-node"><span>BUYER</span><b>Private limit</b><small>Sealed</small></div>
          <div className="deal-line"><i></i><span>REFEREE</span><i></i></div>
          <div className="deal-node"><span>SELLER</span><b>Private floor</b><small>Sealed</small></div>
        </div>
        <div className="home-card-bottom"><span>AGENT NEGOTIATION</span><b>VERIFIABLE RECEIPT ↗</b></div>
      </div>
    </section>
    <section className="home-shortcuts">
      <Link href="/marketplace#browse"><span>01</span><b>Explore marketplace</b><i>↗</i></Link>
      <Link href="/marketplace#portfolio"><span>02</span><b>Manage portfolio</b><i>↗</i></Link>
      <Link href="/marketplace#deals"><span>03</span><b>View your deals</b><i>↗</i></Link>
    </section>
  </main>;
}

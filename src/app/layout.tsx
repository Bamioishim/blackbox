import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Nav, Tabs } from "@/components/Nav";
import { REFEREE_HASH } from "@/lib/referee-hash.generated";
import { heroReceipt } from "@/lib/samples";
import { auditEntries } from "@/lib/verify";
import { CopyHash } from "@/components/CopyHash";
import type { Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0a0b" };

export const metadata: Metadata = {
  title: "Blackbox: private deals between AI agents",
  description: "Two SERV Reasoning agents negotiate. Neither sees the other's limit. A deterministic referee closes the deal and a hash-chained record anyone can verify proves it was fair.",
};

const RULER = ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const r = heroReceipt();
  const audit = r ? auditEntries(r.log) : [];
  const passed = audit.filter((a) => a.hash === "ok" && a.rule !== "fail").length;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SmoothScroll />
        <div className="ruler" aria-hidden>{RULER.map((n, i) => <span key={n} style={{ top: 96 + i * 80 }}>{n}</span>)}</div>
        <div className="wrap">
          <Nav />
          {children}
          <footer className="footer hud">
            <span>Blackbox / built on SERV Reasoning / SERV Hackathon 02</span>
            <span>Referee sha256 <b><CopyHash value={REFEREE_HASH} label="referee hash" /></b></span>
          </footer>
        </div>
        <div className="statbar" role="contentinfo" aria-label="Recorded deal status">
          <div className="stat"><span className="hud">Rounds</span><span className="v">{r?.outcome.round ?? "-"} / {r?.terms.maxRounds ?? "-"}</span></div>
          <div className="stat"><span className="hud">Final price</span><span className="v">{r?.outcome.unitPrice != null ? `${r.outcome.unitPrice} USDC` : "no deal"}</span></div>
          <div className="stat"><span className="hud">Entries verified</span><span className="v">{passed} / {audit.length}</span></div>
          <div className="stat"><span className="hud">Payment</span><span className="v" style={{ color: "#f2b84b" }}>Simulated</span></div>
          <Tabs />
        </div>
      </body>
    </html>
  );
}

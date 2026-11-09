import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Nav } from "@/components/Nav";
import { REFEREE_HASH } from "@/lib/referee-hash.generated";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Blackbox: private deals between AI agents",
  description: "Two SERV Reasoning agents negotiate. Neither sees the other's limit. A deterministic referee closes the deal and a hash-chained record proves it was fair.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <SmoothScroll />
        <div className="wrap">
          <Nav />
          {children}
          <footer className="footer hud">
            <span>Blackbox / built on SERV Reasoning / SERV Hackathon 02</span>
            <span>Referee sha256 <b>{REFEREE_HASH}</b></span>
          </footer>
        </div>
        <div className="statusbar" role="contentinfo" aria-label="Build status">
          <div className="wrap">
            <div className="cell"><span className="hud">Referee</span><span className="v">{REFEREE_HASH.slice(0, 8)}...{REFEREE_HASH.slice(-4)}</span></div>
            <div className="cell"><span className="hud">Agents</span><span className="v">SERV live</span></div>
            <div className="cell"><span className="hud">Payment</span><span className="v" style={{ color: "var(--wax)" }}>Mock</span></div>
            <div className="cell"><span className="hud">Anchor</span><span className="v" style={{ color: "var(--wax)" }}>Not yet</span></div>
            <div className="cell"><span className="hud">Kite testnet</span><span className="v">Chain 2368</span></div>
          </div>
        </div>
      </body>
    </html>
  );
}

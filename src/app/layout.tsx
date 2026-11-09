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
          <footer className="footer">
            <span>Blackbox, built on SERV Reasoning for SERV Hackathon 02.</span>
            <span className="mono">referee sha256 {REFEREE_HASH.slice(0, 16)}...{REFEREE_HASH.slice(-8)}</span>
          </footer>
        </div>
      </body>
    </html>
  );
}

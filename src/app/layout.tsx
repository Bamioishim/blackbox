import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0a0b" };
export const metadata: Metadata = {
  title: "Blackbox",
  description: "Private agent-to-agent deals. Negotiate, agree, verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
    <body><div className="wrap"><Nav />{children}<footer className="footer"><span>Blackbox</span><span>Private deals. Verifiable outcomes.</span></footer></div></body>
  </html>;
}

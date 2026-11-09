"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./Logo";

export function Nav() {
  const p = usePathname();
  const links = [
    { href: "/#how", label: "Method", n: "01" },
    { href: "/deal", label: "Open a deal", n: "02" },
    { href: "/verify", label: "Verify", n: "03" },
  ];
  return (
    <header className="nav">
      <Link href="/" className="wordmark"><LogoMark size={24} />Blackbox</Link>
      <nav className="nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={p === l.href ? "page" : undefined}>{l.label}<sup>{l.n}</sup></Link>
        ))}
      </nav>
      <span className="hud rec"><i aria-hidden />Recording</span>
    </header>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./Logo";

export const TABS = [
  { href: "/deal", label: "Negotiate", n: "01" },
  { href: "/verify", label: "Verify", n: "02" },
  { href: "/#attack", label: "Attack", n: "03" },
  { href: "/verify#archive", label: "Archive", n: "04" },
];

export function Nav() {
  const p = usePathname();
  return (
    <header className="nav">
      <Link href="/" className="wordmark"><LogoMark size={26} />Blackbox</Link>
      <nav className="nav-links">
        {TABS.slice(0, 3).map((l) => (
          <Link key={l.href} href={l.href} aria-current={p === l.href ? "page" : undefined}>{l.label}<sup>{l.n}</sup></Link>
        ))}
      </nav>
      <span className="hud rec"><i aria-hidden />Recording</span>
    </header>
  );
}

export function Tabs() {
  const p = usePathname();
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map((t) => <Link key={t.n} href={t.href} aria-current={p === t.href ? "page" : undefined}><b>{t.n}</b>{t.label}</Link>)}
    </nav>
  );
}

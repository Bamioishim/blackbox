"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";

export const TABS = [
  { href: "/marketplace", label: "Marketplace", n: "01" },
  { href: "/deal", label: "Negotiate", n: "02" },
  { href: "/verify", label: "Verify", n: "03" },
  { href: "/#attack", label: "Attack", n: "04" },
  { href: "/verify#archive", label: "Archive", n: "05" },
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
      <MobileMenu />
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

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const p = usePathname();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  return (
    <>
      <button type="button" className="menu-btn" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className={`menu-icon${open ? " x" : ""}`}><i /><i /></span>{open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="Main">
          {TABS.map((t) => (
            <Link key={t.n} href={t.href} onClick={() => setOpen(false)} aria-current={p === t.href ? "page" : undefined}><b>{t.n}</b>{t.label}<span aria-hidden>&rarr;</span></Link>
          ))}
        </nav>
      )}
    </>
  );
}

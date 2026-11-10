"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "./Logo";

const LINKS = [
  { href: "/marketplace#portfolio", label: "Portfolio" },
  { href: "/marketplace#browse", label: "Marketplace" },
  { href: "/marketplace#deals", label: "Deals" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <header className="nav">
    <Link href="/" className="wordmark"><LogoMark size={26} />Blackbox</Link>
    <nav className="nav-links">{LINKS.map(x => <Link key={x.href} href={x.href} aria-current={pathname === "/marketplace" && x.href.includes("#") ? "page" : undefined}>{x.label}</Link>)}</nav>
    <Link href="/marketplace" className="nav-cta">Open app <span>↗</span></Link>
    <button type="button" className="menu-btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "Close" : "Menu"}</button>
    {open && <nav className="mobile-menu">{LINKS.map(x => <Link key={x.href} href={x.href} onClick={() => setOpen(false)}>{x.label} <span>↗</span></Link>)}</nav>}
  </header>;
}

export function Tabs() { return null; }

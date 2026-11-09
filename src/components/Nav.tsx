"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./Logo";

export function Nav() {
  const p = usePathname();
  const links = [
    { href: "/#how", label: "How it works" },
    { href: "/deal", label: "Open a deal" },
    { href: "/verify", label: "Verify" },
  ];
  return (
    <header className="nav">
      <Link href="/" className="wordmark"><LogoMark size={26} />Blackbox</Link>
      <nav className="nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={p === l.href ? "page" : undefined}>{l.label}</Link>
        ))}
      </nav>
    </header>
  );
}

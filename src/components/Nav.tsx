"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Seal } from "./Seal";

export function Nav() {
  const p = usePathname();
  const links = [
    { href: "/#how", label: "How it works" },
    { href: "/deal", label: "Open a deal" },
    { href: "/verify", label: "Verify" },
  ];
  return (
    <header className="nav">
      <Link href="/" className="wordmark"><Seal size={24} />Sealed</Link>
      <nav className="nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={p === l.href ? "page" : undefined}>{l.label}</Link>
        ))}
      </nav>
    </header>
  );
}

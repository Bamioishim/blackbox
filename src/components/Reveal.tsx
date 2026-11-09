"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Fades and lifts children into place as they scroll in (GSAP ScrollTrigger). */
export function Reveal({ children, as: Tag = "div", style, className }: { children: React.ReactNode; as?: "div" | "section"; style?: React.CSSProperties; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      gsap.from(ref.current!.querySelectorAll("[data-reveal]"), {
        y: 26, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.08,
        scrollTrigger: { trigger: ref.current, start: "top 82%" },
      });
    }, ref);
    return () => ctx.revert();
  }, []);
  return <Tag ref={ref} style={style} className={className}>{children}</Tag>;
}

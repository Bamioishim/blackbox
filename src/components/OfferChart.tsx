"use client";
import { motion, AnimatePresence } from "motion/react";

type Pt = { price: number } | null;
export type ChartRound = { round: number; buyer: Pt; seller: Pt };

const W = 820, H = 440, L = 64, R = 128, T = 28, B = 46;
const spring = { type: "spring" as const, stiffness: 120, damping: 20 };

function fmt(n: number) {
  return Number(n.toFixed(4)).toString();
}

export function OfferChart({
  rounds, maxRounds, reveal, price, closedRound, blockedRounds = [], title,
}: {
  rounds: ChartRound[];
  maxRounds: number;
  reveal?: { buyer: number; seller: number } | null;
  price?: number | null;
  closedRound?: number | null;
  blockedRounds?: number[];
  title?: string;
}) {
  const values: number[] = [];
  rounds.forEach((r) => { if (r.buyer) values.push(r.buyer.price); if (r.seller) values.push(r.seller.price); });
  if (reveal) values.push(reveal.buyer, reveal.seller);
  if (price) values.push(price);
  if (!values.length) values.push(1);
  let lo = Math.min(...values), hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const span = Math.max(hi - lo, mid * 0.04);
  lo = mid - span * 0.68; hi = mid + span * 0.68;

  const x = (r: number) => L + ((r - 1) / Math.max(1, maxRounds - 1)) * (W - L - R);
  const y = (p: number) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((i + 0.5) / 5) * (hi - lo));

  const series = (side: "buyer" | "seller") =>
    rounds.filter((r) => r[side]).map((r) => ({ round: r.round, p: (r[side] as { price: number }).price }));
  const buyer = series("buyer");
  const seller = series("seller");

  // Right-hand labels: nudge apart so they never overlap.
  const labels: { key: string; y: number; ly: number }[] = [];
  if (reveal) { labels.push({ key: "b", y: y(reveal.buyer), ly: 0 }, { key: "s", y: y(reveal.seller), ly: 0 }); }
  if (price != null && closedRound != null) labels.push({ key: "p", y: y(price), ly: 0 });
  labels.sort((a, b) => a.y - b.y).forEach((l, i, arr) => { l.ly = i === 0 ? l.y : Math.max(l.y, arr[i - 1].ly + 17); });
  const ly = (k: string, fallback: number) => (labels.find((l) => l.key === k)?.ly ?? fallback) + 4;

  const segs = (pts: { round: number; p: number }[]) =>
    pts.slice(1).map((pt, i) => ({ key: `${pts[i].round}-${pt.round}`, d: `M${x(pts[i].round)},${y(pts[i].p)} L${x(pt.round)},${y(pt.p)}` }));

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title ?? "Offers by round"} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <pattern id="hatchB" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" strokeOpacity=".16" strokeWidth="2" />
          </pattern>
          <pattern id="hatchS" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" strokeOpacity=".16" strokeWidth="2" />
          </pattern>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth="1" />
            <text x={L - 12} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)" fontFamily="var(--font-geist-mono)">{fmt(t)}</text>
          </g>
        ))}
        {Array.from({ length: maxRounds }, (_, i) => i + 1).map((r) => (
          <text key={r} x={x(r)} y={H - B + 26} textAnchor="middle" fontSize="12" fill="var(--muted)" fontFamily="var(--font-geist-mono)">R{r}</text>
        ))}

        <AnimatePresence>
          {reveal && (
            <motion.g key="bands" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
              <motion.rect x={L} width={W - L - R} y={y(reveal.buyer)} height={Math.max(0, H - B - y(reveal.buyer))} fill="url(#hatchB)"
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ transformOrigin: `0px ${y(reveal.buyer)}px` }} transition={{ ...spring, delay: 0.1 }} />
              <motion.rect x={L} width={W - L - R} y={T} height={Math.max(0, y(reveal.seller) - T)} fill="url(#hatchS)"
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ transformOrigin: `0px ${y(reveal.seller)}px` }} transition={{ ...spring, delay: 0.35 }} />
              {reveal.buyer >= reveal.seller && (
                <motion.rect x={L} width={W - L - R} y={y(reveal.buyer)} height={y(reveal.seller) - y(reveal.buyer)} fill="var(--wax-soft)"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8, duration: 0.5 }} />
              )}
              <line x1={L} x2={W - R} y1={y(reveal.buyer)} y2={y(reveal.buyer)} stroke="var(--ink)" strokeWidth="1.2" />
              <line x1={L} x2={W - R} y1={y(reveal.seller)} y2={y(reveal.seller)} stroke="var(--ink)" strokeWidth="1.2" strokeDasharray="6 5" />
              <text x={W - R + 10} y={ly("b", y(reveal.buyer))} fontSize="12.5" fill="var(--ink)">buyer ceiling {fmt(reveal.buyer)}</text>
              <text x={W - R + 10} y={ly("s", y(reveal.seller))} fontSize="12.5" fill="var(--ink)">seller floor {fmt(reveal.seller)}</text>
            </motion.g>
          )}
        </AnimatePresence>

        {blockedRounds.map((r, i) => (
          <g key={`b${r}-${i}`}>
            <line x1={x(r)} x2={x(r)} y1={T} y2={H - B} stroke="var(--wax)" strokeOpacity=".5" strokeDasharray="2 4" />
            <text x={x(r) + 6} y={T + 12} fontSize="11.5" fill="var(--wax)">blocked injection</text>
          </g>
        ))}

        {segs(seller).map((s) => (
          <motion.path key={"s" + s.key} d={s.d} fill="none" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="7 5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} />
        ))}
        {segs(buyer).map((s) => (
          <motion.path key={"b" + s.key} d={s.d} fill="none" stroke="var(--ink)" strokeWidth="2.4"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: "easeOut" }} />
        ))}
        {seller.map((p) => (
          <motion.circle key={"sc" + p.round} cx={x(p.round)} cy={y(p.p)} r={5} fill="var(--paper)" stroke="var(--ink-2)" strokeWidth="2"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        ))}
        {buyer.map((p) => (
          <motion.circle key={"bc" + p.round} cx={x(p.round)} cy={y(p.p)} r={5} fill="var(--ink)"
            initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        ))}

        <AnimatePresence>
          {price != null && closedRound != null && (
            <motion.g key="price" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: 0.2 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              <line x1={L} x2={W - R} y1={y(price)} y2={y(price)} stroke="var(--wax)" strokeWidth="1" strokeDasharray="3 4" />
              <circle cx={x(closedRound)} cy={y(price)} r={11} fill="var(--wax)" />
              <circle cx={x(closedRound)} cy={y(price)} r={6.5} fill="none" stroke="#f2ede3" strokeOpacity=".7" />
              <text x={W - R + 10} y={ly("p", y(price))} fontSize="13" fill="var(--wax)" fontWeight="600">settled {fmt(price)}</text>
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
      <figcaption style={{ display: "flex", gap: 22, fontSize: 13.5, color: "var(--muted)", marginTop: 8, flexWrap: "wrap" }}>
        <span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" stroke="var(--ink)" strokeWidth="2.4" /></svg> buyer bids</span>
        <span><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="7 5" /></svg> seller asks</span>
        {reveal && <span><svg width="14" height="12"><rect width="14" height="12" fill="var(--wax-soft)" stroke="var(--wax)" strokeOpacity=".3" /></svg> price both owners would accept, shown only after reveal</span>}
      </figcaption>
    </figure>
  );
}

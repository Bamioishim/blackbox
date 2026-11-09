"use client";
import { useEffect, useRef } from "react";
import type { Receipt } from "@/lib/receipt";
import { chartData } from "@/lib/view";

type V3 = [number, number, number];
type Pt = { p: V3; a: number; c: 0 | 1 | 2 | 3; s?: number }; // 0 ink, 1 grey, 2 accent, 3 faint
type Anchor = { id: string; p: V3; flag: string; text: string };

/** Seeded PRNG so the cloud is identical on every load. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/**
 * A recorded deal drawn as a point-cloud "black box": the box wireframe, the buyer's bids and the
 * seller's asks as dotted tracks inside it, closing at the settled price. Flags mark every refusal.
 */
export function PointCloud({ receipt }: { receipt: Receipt }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cv = canvas.current!, ly = layer.current!;
    const ctx = cv.getContext("2d")!;
    const rand = rng(7);
    const d = chartData(receipt.log);
    const pts: Pt[] = [];
    const W = 1.15, H = 0.72, D = 0.62; // half extents
    const corners: V3[] = [];
    for (const x of [-W, W]) for (const y of [-H, H]) for (const z of [-D, D]) corners.push([x, y, z]);
    const edges = corners.flatMap((a, i) => corners.slice(i + 1).filter((b) => [0, 1, 2].filter((k) => a[k] !== b[k]).length === 1).map((b) => [a, b] as [V3, V3]));
    for (const [a, b] of edges) {
      const n = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 260);
      for (let i = 0; i < n; i++) {
        const t = rand(), j = () => (rand() - 0.5) * 0.025;
        pts.push({ p: [a[0] + (b[0] - a[0]) * t + j(), a[1] + (b[1] - a[1]) * t + j(), a[2] + (b[2] - a[2]) * t + j()], a: 0.55 + rand() * 0.45, c: 0 });
      }
    }
    // faces: sparse scan noise, denser near the floor
    for (let i = 0; i < 2600; i++) {
      const face = Math.floor(rand() * 5);
      let p: V3;
      const u = (rand() * 2 - 1), v = (rand() * 2 - 1);
      if (face === 0) p = [u * W, -H, v * D]; else if (face === 1) p = [-W, v * H, u * D]; else if (face === 2) p = [W, v * H, u * D]; else if (face === 3) p = [u * W, v * H, -D]; else p = [u * W, H, v * D];
      pts.push({ p, a: 0.12 + rand() * 0.22, c: 3 });
    }
    // ground scatter + orbit rings
    for (let i = 0; i < 1800; i++) {
      const r = 1.4 + rand() * 1.6, th = rand() * Math.PI * 2;
      pts.push({ p: [Math.cos(th) * r, -H - 0.02, Math.sin(th) * r * 0.8], a: 0.05 + rand() * 0.14, c: 3 });
    }
    for (const [rad, tilt] of [[2.1, 0.18], [2.7, -0.08]] as const) {
      for (let i = 0; i < 520; i++) {
        if (i % 3 === 0) continue;
        const th = (i / 520) * Math.PI * 2;
        pts.push({ p: [Math.cos(th) * rad, Math.sin(th) * rad * tilt + 0.25, Math.sin(th) * rad * 0.62], a: 0.32, c: 1 });
      }
    }
    // the negotiation inside the box: x = round, y = price
    const prices: number[] = [];
    d.rounds.forEach((r) => { if (r.buyer) prices.push(r.buyer.price); if (r.seller) prices.push(r.seller.price); });
    if (d.reveal) prices.push(d.reveal.buyer, d.reveal.seller);
    const lo = Math.min(...prices, 1), hi = Math.max(...prices, 0);
    const X = (round: number) => -W * 0.86 + ((round - 1) / Math.max(1, d.maxRounds - 1)) * W * 1.72;
    const Y = (price: number) => -H * 0.8 + ((price - lo) / Math.max(1e-9, hi - lo)) * H * 1.6;
    const track = (side: "buyer" | "seller", c: 0 | 1, z: number) => {
      const s = d.rounds.filter((r) => r[side]).map((r) => [X(r.round), Y(r[side]!.price)] as const);
      for (let k = 0; k < s.length; k++) {
        for (let q = 0; q < 26; q++) pts.push({ p: [s[k][0] + (rand() - 0.5) * 0.06, s[k][1] + (rand() - 0.5) * 0.06, z + (rand() - 0.5) * 0.06], a: 1, c, s: 2 });
        if (k) for (let i = 0; i < 90; i++) { const t = i / 90; pts.push({ p: [s[k - 1][0] + (s[k][0] - s[k - 1][0]) * t, s[k - 1][1] + (s[k][1] - s[k - 1][1]) * t, z], a: 0.9, c, s: 1.7 }); }
      }
    };
    track("buyer", 0, 0.08); track("seller", 1, -0.08);
    if (d.reveal) for (const [lim, z] of [[d.reveal.buyer, 0], [d.reveal.seller, 0]] as const) for (let i = 0; i < 160; i++) if (i % 2) pts.push({ p: [-W * 0.95 + (i / 160) * W * 1.9, Y(lim), z + Math.sin(i) * 0.3], a: 0.35, c: 2 });
    const anchors: Anchor[] = [];
    if (d.price != null && d.closedRound != null) {
      const sp: V3 = [X(d.closedRound), Y(d.price), 0];
      for (let i = 0; i < 260; i++) { const r = Math.pow(rand(), 2) * 0.12, a = rand() * 6.283, b = rand() * 3.14; pts.push({ p: [sp[0] + r * Math.cos(a) * Math.sin(b), sp[1] + r * Math.cos(b), sp[2] + r * Math.sin(a) * Math.sin(b)], a: 0.9, c: 2 }); }
      const inside = d.reveal ? d.price <= d.reveal.buyer && d.price >= d.reveal.seller : null;
      anchors.push({ id: "settle", p: [sp[0], sp[1] + 0.06, 0], flag: "", text: `Settled ${d.price}${inside === null ? "" : inside ? " · inside both limits" : " · outside limits"}` });
    }
    d.flags.forEach((f, i) => {
      const bidHere = d.rounds.find((r) => r.round === f.round);
      const pr = bidHere?.seller?.price ?? bidHere?.buyer?.price ?? (lo + hi) / 2;
      const p: V3 = [X(f.round) + i * 0.22, Math.min(H * 1.15, Y(pr) + 0.24 + i * 0.36), 0];
      for (let k = 0; k < 120; k++) pts.push({ p: [p[0] + (rand() - 0.5) * 0.02, p[1] - rand() * (p[1] + H), p[2]], a: 0.5, c: 2 });
      anchors.push({ id: `f${i}`, p, flag: `Flag-0${i + 1}`, text: `${f.label} · R${f.round}` });
    });
    // HTML callouts
    ly.innerHTML = "";
    const els = anchors.map((a) => {
      const el = document.createElement("div");
      el.className = "callout";
      el.innerHTML = a.flag ? `<b>${a.flag.toUpperCase()}</b>${a.text}` : `<b>SETTLE</b>${a.text}`;
      ly.appendChild(el);
      return el;
    });

    const pitch = 0.42;
    let yaw = -0.35, drag: { x: number; yaw: number } | null = null, raf = 0, w = 0, h = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const COL = ["233,230,223", "150,150,150", "126,179,247", "233,230,223"];
    const project = (p: V3) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
      const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp;
      const f = 4.2 / (4.2 + z2), s = Math.min(w, h * 1.45) * 0.3;
      return [w / 2 + x1 * f * s, h * 0.52 - y2 * f * s, f] as const;
    };
    const t0 = performance.now();
    const draw = (t: number) => {
      if (!drag && !reduce) yaw = -0.35 + Math.sin((t - t0) / 9000) * 0.35;
      ctx.clearRect(0, 0, w, h);
      for (const q of pts) {
        const [x, y, f] = project(q.p);
        ctx.fillStyle = `rgba(${COL[q.c]},${q.a * Math.min(1, f)})`;
        const s = q.s ? q.s * f : q.c === 2 ? 1.6 : 1.1 * f;
        ctx.fillRect(x, y, s, s);
      }
      const boxes: { l: number; r: number; t: number; b: number }[] = [];
      anchors.forEach((a, i) => {
        const [x, y] = project(a.p);
        const ew = els[i].offsetWidth, eh = els[i].offsetHeight, hw = ew / 2;
        const cx = Math.max(hw + 2, Math.min(w - hw - 2, x));
        let top = Math.max(eh + 2, y - 8);
        // keep callouts from stacking on top of each other
        for (let pass = 0; pass < 3; pass++) for (const o of boxes) if (cx - hw < o.r && cx + hw > o.l && top - eh < o.b && top > o.t) top = o.t - 3;
        top = Math.max(eh + 2, top);
        boxes.push({ l: cx - hw, r: cx + hw, t: top - eh, b: top });
        els[i].style.left = `${cx}px`; els[i].style.top = `${top}px`;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const down = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; drag = { x: e.clientX, yaw }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) / 260; };
    const up = () => { drag = null; };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
  }, [receipt]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "pan-y pinch-zoom" }} aria-label="Recorded negotiation drawn as a point cloud: bids and asks converge inside the box, flags mark refused offers" role="img" />
      <div ref={layer} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}

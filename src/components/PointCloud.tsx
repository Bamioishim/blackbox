"use client";
import { useEffect, useRef, useState } from "react";
import type { Receipt } from "@/lib/receipt";
import { chartData } from "@/lib/view";
import { formationState } from "@/lib/formation";

type V3 = [number, number, number];
type Pt = { p: V3; a: number; c: 0 | 1 | 2 | 3; s?: number }; // 0 ink, 1 grey, 2 accent, 3 faint

/** Seeded PRNG so the cloud is identical on every load. */
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function mix(a: number, b: number, t: number) { return a + (b - a) * t; }
function hexBytes(hash: string) {
  const h = hash.replace(/^0x/, "").replace(/[^0-9a-f]/gi, "") || "00";
  const out: number[] = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16) || 0);
  return out.length ? out : [0];
}

/**
 * A recorded deal drawn as a point-cloud "black box". After a short spin the box
 * plays how a price forms: sealed limits enter and hide, offers converge, the
 * referee checks, a price is sealed, and a receipt comes out.
 */
export function PointCloud({ receipt }: { receipt: Receipt }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [caption, setCaption] = useState(() => formationState(0, false).caption);
  const [canDrag, setCanDrag] = useState(false);

  useEffect(() => {
    const cv = canvas.current!;
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

    const prices: number[] = [];
    d.rounds.forEach((r) => { if (r.buyer) prices.push(r.buyer.price); if (r.seller) prices.push(r.seller.price); });
    if (d.reveal) prices.push(d.reveal.buyer, d.reveal.seller);
    if (d.price != null) prices.push(d.price);
    const lo = Math.min(...prices, 1), hi = Math.max(...prices, 0);
    const X = (round: number) => -W * 0.86 + ((round - 1) / Math.max(1, d.maxRounds - 1)) * W * 1.72;
    const Y = (price: number) => -H * 0.8 + ((price - lo) / Math.max(1e-9, hi - lo)) * H * 1.6;
    const buyerLim = d.reveal?.buyer ?? hi;
    const sellerLim = d.reveal?.seller ?? lo;
    const settled: V3 | null = d.price != null && d.closedRound != null ? [X(d.closedRound), Y(d.price), 0] : (d.price != null ? [0, Y(d.price), 0] : [0, (Y(buyerLim) + Y(sellerLim)) / 2, 0]);

    const polyline = (side: "buyer" | "seller") => {
      const s = d.rounds.filter((r) => r[side]).map((r) => [X(r.round), Y(r[side]!.price)] as const);
      const segs: { a: readonly [number, number]; b: readonly [number, number]; len: number }[] = [];
      for (let k = 1; k < s.length; k++) {
        const len = Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1]);
        segs.push({ a: s[k - 1], b: s[k], len });
      }
      const nodes = s;
      const total = segs.reduce((n, s) => n + s.len, 0) || 1;
      return { nodes, segs, total };
    };
    const buyerTrack = polyline("buyer");
    const sellerTrack = polyline("seller");
    const packetRand = rng(21);
    const buyerPacket: V3[] = [];
    const sellerPacket: V3[] = [];
    for (let i = 0; i < 90; i++) {
      const j = (): V3 => [(packetRand() - 0.5) * 0.16, (packetRand() - 0.5) * 0.1, (packetRand() - 0.5) * 0.1];
      buyerPacket.push(j()); sellerPacket.push(j());
    }
    const hashBytes = hexBytes(receipt.finalHash);
    const hashShort = receipt.finalHash.replace(/^0x/, "").slice(0, 16);

    const pitch = 0.42;
    let yaw = -0.35, drag: { x: number; yaw: number } | null = null, raf = 0, w = 0, h = 0, lastT = 0, lastCaption = "";
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceMq.matches;
    const onReduce = () => { reduce = reduceMq.matches; };
    reduceMq.addEventListener?.("change", onReduce);
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
    const dot = (p: V3, a: number, c: 0 | 1 | 2 | 3, size = 1.2) => {
      if (a <= 0.02) return;
      const [x, y, f] = project(p);
      ctx.fillStyle = `rgba(${COL[c]},${Math.min(1, a * Math.min(1, f))})`;
      const s = size * f;
      ctx.fillRect(x, y, s, s);
    };
    const t0 = performance.now();
    lastT = t0;
    const restYaw = -0.55;
    const draw = (t: number) => {
      const dt = Math.min(48, t - lastT); lastT = t;
      const story = formationState(reduce ? 0 : (t - t0), reduce);
      if (story.caption !== lastCaption) { lastCaption = story.caption; setCaption(story.caption); }
      if (!drag && !reduce) {
        if (story.phase === "spin" || story.fadeOut > 0.4) yaw += 0.0007 * dt;
        else yaw += (restYaw - yaw) * (0.04 + story.yawNudge * 0.02);
      }
      ctx.clearRect(0, 0, w, h);
      for (const q of pts) {
        const [x, y, f] = project(q.p);
        ctx.fillStyle = `rgba(${COL[q.c]},${q.a * Math.min(1, f)})`;
        const s = q.s ? q.s * f : q.c === 2 ? 1.6 : 1.1 * f;
        ctx.fillRect(x, y, s, s);
      }

      // Sealed commitments travel in from opposite sides, then hide as faint planes.
      const buyerPos: V3 = [mix(-2.25, -W * 0.62, story.buyerIn), Y(buyerLim), 0];
      const sellerPos: V3 = [mix(2.25, W * 0.62, story.sellerIn), Y(sellerLim), 0];
      const packetA = (entered: number) => entered * (1 - story.hidden * 0.88);
      for (const o of buyerPacket) dot([buyerPos[0] + o[0], buyerPos[1] + o[1], buyerPos[2] + o[2]], packetA(story.buyerIn), 0, 1.5);
      for (const o of sellerPacket) dot([sellerPos[0] + o[0], sellerPos[1] + o[1], sellerPos[2] + o[2]], packetA(story.sellerIn), 1, 1.5);
      if (story.hidden > 0.02) {
        for (let i = 0; i < 70; i++) {
          if (i % 3 === 0) continue;
          const x = -W * 0.9 + (i / 69) * W * 1.8;
          const z = Math.sin(i * 0.7) * D * 0.55;
          dot([x, Y(buyerLim), z], story.hidden * 0.42, 2, 1.3);
          dot([x, Y(sellerLim), z], story.hidden * 0.42, 2, 1.3);
        }
      }

      // Offer tracks grow along the recorded bids and asks.
      const drawTrack = (track: typeof buyerTrack, c: 0 | 1, z: number) => {
        const visible = story.offerProgress * track.total;
        let acc = 0;
        for (const node of track.nodes) {
          const shown = acc <= visible || track.segs.length === 0;
          if (shown) {
            for (let q = 0; q < 18; q++) dot([node[0] + (q - 9) * 0.004, node[1], z], story.offerProgress, c, 2);
          }
          // accumulate after the node so the first offer appears as soon as progress starts
        }
        acc = 0;
        for (const seg of track.segs) {
          const take = Math.max(0, Math.min(seg.len, visible - acc));
          if (take > 0) {
            const u = take / seg.len;
            const steps = Math.max(4, Math.round(90 * u));
            for (let i = 0; i <= steps; i++) {
              const tt = (i / steps) * u;
              dot([mix(seg.a[0], seg.b[0], tt), mix(seg.a[1], seg.b[1], tt), z], story.offerProgress * 0.95, c, 1.7);
            }
          }
          acc += seg.len;
          if (acc >= visible) break;
        }
        // first node always appears with any offer progress
        if (story.offerProgress > 0 && track.nodes[0]) {
          const n = track.nodes[0];
          for (let q = 0; q < 22; q++) dot([n[0] + (q - 11) * 0.004, n[1], z], Math.min(1, story.offerProgress * 2), c, 2.1);
        }
      };
      if (story.offerProgress > 0.01) {
        drawTrack(buyerTrack, 0, 0.08);
        drawTrack(sellerTrack, 1, -0.08);
      }

      // Referee scan, then a check around the meeting point.
      if (story.referee > 0.02 && settled) {
        const scan = -W + story.referee * W * 2;
        for (let i = 0; i < 80; i++) {
          const y = -H * 0.85 + (i / 79) * H * 1.7;
          const z = ((i % 2) ? 1 : -1) * D * 0.2;
          dot([scan, y, z], story.referee * 0.7, 2, 1.5);
        }
        if (story.referee > 0.55) {
          const br = (story.referee - 0.55) / 0.45;
          for (const [dx, dy] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) {
            for (let i = 0; i < 10; i++) {
              const t = i / 9 * br;
              if (dx < 0) dot([settled[0] + dx + 0.05 * t, settled[1] + dy, 0], br, 2, 1.6);
              else dot([settled[0] + dx - 0.05 * t, settled[1] + dy, 0], br, 2, 1.6);
              dot([settled[0] + dx, settled[1] + dy + (dy < 0 ? 0.05 * t : -0.05 * t), 0], br, 2, 1.6);
            }
          }
        }
      }

      // Sealed price blooms at the agreed point.
      if (story.seal > 0.02 && settled) {
        const rMax = 0.12 * story.seal;
        for (let i = 0; i < 260; i++) {
          const r = Math.pow((i * 17.3) % 1, 2) * rMax;
          const a = ((i * 13.1) % 1) * 6.283, b = ((i * 7.9) % 1) * 3.14;
          dot([settled[0] + r * Math.cos(a) * Math.sin(b), settled[1] + r * Math.cos(b), settled[2] + r * Math.sin(a) * Math.sin(b)], 0.9 * story.seal, 2, 1.6);
        }
      }

      // Receipt / fingerprint slides out of the front of the box.
      if (story.receipt > 0.02) {
        const cx = 0, cy = -H - 0.02 - story.receipt * 0.38, cz = D + 0.08 + story.receipt * 0.28;
        const cw = 0.42, ch = 0.28;
        // card frame
        for (let i = 0; i < 80; i++) {
          const u = i / 79;
          dot([cx - cw + u * cw * 2, cy + ch, cz], story.receipt * 0.8, 0, 1.3);
          dot([cx - cw + u * cw * 2, cy - ch, cz], story.receipt * 0.8, 0, 1.3);
          dot([cx - cw, cy - ch + u * ch * 2, cz], story.receipt * 0.8, 0, 1.3);
          dot([cx + cw, cy - ch + u * ch * 2, cz], story.receipt * 0.8, 0, 1.3);
        }
        // hash barcode
        for (let i = 0; i < 16; i++) {
          const bx = cx - cw * 0.72 + (i / 15) * cw * 0.7;
          const bh = 0.06 + (hashBytes[i % hashBytes.length] / 255) * 0.14;
          const steps = 8;
          for (let k = 0; k <= steps; k++) dot([bx, cy + ch * 0.15 - bh * (k / steps), cz], story.receipt * 0.85, 2, 1.4);
        }
        // fingerprint ridges
        for (let ring = 0; ring < 5; ring++) {
          const rad = 0.05 + ring * 0.028;
          for (let i = 0; i < 36; i++) {
            if ((i + ring * 3) % 6 === 0) continue;
            const th = (i / 36) * Math.PI * 2 + ring * 0.25;
            dot([cx + cw * 0.42 + Math.cos(th) * rad, cy + Math.sin(th) * rad * 0.85, cz], story.receipt * 0.75, 0, 1.2);
          }
        }
        const [tx, ty, tf] = project([cx - cw * 0.7, cy + ch * 0.72, cz]);
        ctx.globalAlpha = Math.min(1, story.receipt * tf);
        ctx.fillStyle = "rgba(233,230,223,0.85)";
        ctx.font = `${Math.max(9, 10 * tf)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(hashShort, tx, ty);
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const down = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; drag = { x: e.clientX, yaw }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (drag) yaw = drag.yaw + (e.clientX - drag.x) / 260; };
    const up = () => { drag = null; };
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
    setCanDrag(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      reduceMq.removeEventListener?.("change", onReduce);
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up);
    };
  }, [receipt]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block", cursor: canDrag ? "grab" : "default", touchAction: "pan-y pinch-zoom" }} aria-label="Illustration of how a Blackbox price forms: sealed limits enter the box, offers converge, the referee checks, a price is sealed, and a receipt comes out" role="img" />
      <div className="landing-cloud-ui">
        <p className="landing-cloud-caption" aria-live="polite">{caption}</p>
        {canDrag && <span className="landing-cloud-hint">Drag to orbit</span>}
      </div>
    </div>
  );
}

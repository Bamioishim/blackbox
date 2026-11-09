"use client";
import { useEffect, useState } from "react";
import type { Receipt } from "@/lib/receipt";
import { chartData } from "@/lib/view";
import { OfferChart } from "./OfferChart";

/** Replays a recorded deal round by round, then reveals the limits. */
export function HeroChart({ receipt }: { receipt: Receipt }) {
  const full = chartData(receipt.log);
  const [n, setN] = useState(0);
  useEffect(() => {
    const total = full.rounds.length + 2;
    if (n >= total) return;
    const t = setTimeout(() => setN((x) => x + 1), n === 0 ? 500 : 650);
    return () => clearTimeout(t);
  }, [n, full.rounds.length]);
  const shownRounds = full.rounds.slice(0, n);
  const done = n > full.rounds.length;
  return (
    <OfferChart
      rounds={shownRounds}
      maxRounds={full.maxRounds}
      blockedRounds={full.blockedRounds.filter((r) => r <= n)}
      reveal={done ? full.reveal : null}
      price={done ? full.price : null}
      closedRound={done ? full.closedRound : null}
      title="A recorded negotiation"
    />
  );
}

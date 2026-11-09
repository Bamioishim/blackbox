import { verifyMessage } from "viem";
import { canonical } from "./canonical";
import { verifyChain, type LogEntry } from "./chain";
import { checkReveal, priceWithinLimits, type Commitment, type Reveal } from "./commit";
import { replay } from "./referee";
import { roundsFromLog, type Receipt } from "./receipt";
import { REFEREE_HASH } from "./referee-hash.generated";
import type { SessionIntent, Delegation, PaymentAttempt } from "./settle";

export type Check = { id: string; label: string; ok: boolean | null; detail: string };

function find(log: LogEntry[], kind: LogEntry["kind"]) {
  return log.filter((e) => e.kind === kind);
}

export async function verifyReceipt(r: Receipt, publishedRefereeHash = REFEREE_HASH): Promise<Check[]> {
  const checks: Check[] = [];
  const log = Array.isArray(r?.log) ? r.log : [];

  // 1. Hash chain
  const chain = verifyChain(log);
  checks.push({
    id: "chain", label: "Hash chain intact", ok: chain.ok,
    detail: chain.ok ? `${log.length} entries, each one points at the hash before it.` : `${chain.reason}. Everything from entry ${chain.brokenAt} on can't be trusted.`,
  });
  const headOk = chain.ok && log.length > 0 && log[log.length - 1].hash === r.finalHash;
  checks.push({ id: "final", label: "Final hash matches the log", ok: headOk, detail: headOk ? r.finalHash : "The receipt's final hash is not the last entry of this log." });

  // 2. Referee code
  const refOk = r.referee?.hash === publishedRefereeHash;
  checks.push({
    id: "referee", label: "Referee code matches the published hash", ok: refOk,
    detail: refOk ? publishedRefereeHash : `Receipt says ${r.referee?.hash ?? "nothing"}, this site publishes ${publishedRefereeHash}.`,
  });

  // 3. Replay the referee on the logged offers
  const open = find(log, "deal.open")[0]?.payload as { quantity?: number; maxRounds?: number } | undefined;
  const closed = find(log, "deal.closed")[0]?.payload as { unitPrice?: number; round?: number; total?: number } | undefined;
  try {
    const s = replay({ quantity: Number(open?.quantity), maxRounds: Number(open?.maxRounds) }, roundsFromLog(log));
    const same = closed ? s.status === "closed" && s.price === closed.unitPrice && s.closedRound === closed.round : s.status !== "closed";
    checks.push({
      id: "replay", label: "Re-running the referee gives the same result", ok: same,
      detail: same ? (closed ? `Closes in round ${s.closedRound} at ${s.price}.` : "No deal, as recorded.") : `Replay says ${s.status} at ${s.price ?? "none"}; the log says ${closed?.unitPrice ?? "no deal"}.`,
    });
  } catch (e) {
    checks.push({ id: "replay", label: "Re-running the referee gives the same result", ok: false, detail: String((e as Error).message) });
  }

  // 4. Commit-reveal
  const commits = find(log, "commit").map((e) => e.payload as unknown as Commitment);
  const reveals = find(log, "reveal").map((e) => e.payload as unknown as Reveal);
  const commitFirst = (() => {
    const firstOffer = log.findIndex((e) => e.kind.startsWith("offer."));
    const lastCommit = log.map((e) => e.kind).lastIndexOf("commit");
    return commits.length === 2 && (firstOffer === -1 || lastCommit < firstOffer);
  })();
  checks.push({ id: "commit-order", label: "Both limits were committed before any offer", ok: commitFirst, detail: commitFirst ? commits.map((c) => `${c.side}: ${c.commitment.slice(0, 16)}...`).join("  ") : "Commitments missing or written after haggling started." });
  if (reveals.length === 0) {
    checks.push({ id: "reveal", label: "Revealed limits match their commitments", ok: null, detail: "Limits not revealed." });
  } else {
    const okAll = reveals.length === 2 && reveals.every((rv) => { const c = commits.find((x) => x.side === rv.side); return !!c && checkReveal(c, rv); });
    checks.push({ id: "reveal", label: "Revealed limits match their commitments", ok: okAll, detail: okAll ? reveals.map((rv) => `${rv.side} ${rv.side === "buyer" ? "ceiling" : "floor"} ${Number(rv.limit)}`).join(", ") : "A revealed limit does not hash to its commitment." });
  }
  if (closed && reveals.length === 2) {
    const b = reveals.find((x) => x.side === "buyer")!;
    const s = reveals.find((x) => x.side === "seller")!;
    const w = priceWithinLimits(Number(closed.unitPrice), b, s);
    const ok = w.buyerOk && w.sellerOk;
    checks.push({ id: "within", label: "Price sits inside both limits", ok, detail: `${s ? Number(s.limit) : "?"} <= ${closed.unitPrice} <= ${b ? Number(b.limit) : "?"}` });
  }

  // 5. Settlement
  const sessE = find(log, "settle.session")[0]?.payload as { session?: SessionIntent; delegation?: Delegation } | undefined;
  const payE = find(log, "settle.payment")[0]?.payload as unknown as PaymentAttempt | undefined;
  if (!closed) {
    checks.push({ id: "caps", label: "Payment session capped at the deal amount", ok: null, detail: "No deal, nothing to settle." });
  } else if (!sessE?.session) {
    checks.push({ id: "caps", label: "Payment session capped at the deal amount", ok: false, detail: "No settlement session in the log." });
  } else {
    const ss = sessE.session;
    const total = Number(closed.total).toFixed(6);
    const ttl = (Date.parse(ss.expiresAt) - Date.parse(ss.createdAt)) / 1000;
    const capsOk = ss.maxTotalAmount === total && ss.maxAmountPerTx === total && ttl > 0 && ttl <= 900;
    checks.push({ id: "caps", label: "Payment session capped at the deal amount", ok: capsOk, detail: `per-tx ${ss.maxAmountPerTx}, total ${ss.maxTotalAmount}, expires after ${Math.round(ttl / 60)} min. Deal total ${total}.` });
    let sigOk = false;
    try {
      const d = sessE.delegation!;
      sigOk = d.message === canonical(ss) && (await verifyMessage({ address: d.signer as `0x${string}`, message: d.message, signature: d.signature as `0x${string}` }));
    } catch { sigOk = false; }
    checks.push({ id: "delegation", label: "Session delegation signature valid", ok: sigOk, detail: (ss.mode === "mock" ? "MOCK key. " : "") + (sigOk ? `Signed by ${sessE.delegation?.signer}` : "Signature does not match the session.") });
    const payOk = !!payE && payE.ok && payE.amount === total;
    checks.push({ id: "payment", label: ss.mode === "mock" ? "Payment (mock)" : "Payment", ok: payOk, detail: payE ? `${payE.amount} USDC, ${payE.code}${ss.mode === "mock" ? ". No money moved." : ""}` : "No payment entry." });
  }

  // 6. Anchor
  checks.push(
    r.anchor?.status === "anchored"
      ? { id: "anchor", label: "Final hash anchored onchain", ok: r.anchor.finalHash === r.finalHash, detail: `${r.anchor.chain}: ${r.anchor.explorerUrl}` }
      : { id: "anchor", label: "Final hash anchored onchain", ok: null, detail: "Not anchored yet. The contract is written but not deployed." },
  );
  return checks;
}

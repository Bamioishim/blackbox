import { verifyMessage, encodeFunctionData, decodeFunctionResult, keccak256, toBytes } from "viem";
import { canonical } from "./canonical";
import { verifyChain, type LogEntry } from "./chain";
import { checkReveal, priceWithinLimits, type Commitment, type Reveal } from "./commit";
import { replay, initialState, judge, closeRound, type RefereeState, type Side } from "./referee";
import type { Offer } from "./schema";
import { roundsFromLog, type Receipt } from "./receipt";
import { REFEREE_HASH } from "./referee-hash.generated";
import { checkBudgetReveal, type SessionIntent, type Delegation, type PaymentAttempt, type BudgetCommitment, type BudgetReveal } from "./settle";
import { offerMessage, KITE_AGENTS, type AgentIdentity } from "./identity";

export type Check = { id: string; label: string; ok: boolean | null; detail: string };

function find(log: LogEntry[], kind: LogEntry["kind"]) {
  return log.filter((e) => e.kind === kind);
}

const RPC: Record<number, string> = { 2368: "https://rpc-testnet.gokite.ai/", 2366: "https://rpc.gokite.ai/" };
const ANCHORS_ABI = [{ type: "function", name: "anchors", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }],
  outputs: [{ name: "finalHash", type: "bytes32" }, { name: "refereeHash", type: "bytes32" }, { name: "blockTime", type: "uint64" }, { name: "writer", type: "address" }] }] as const;

/** Reads the anchor straight from the chain's public RPC, so the check doesn't trust the receipt. */
export async function readAnchor(chainId: number, contract: string, dealId: string) {
  const rpc = RPC[chainId];
  if (!rpc) throw new Error(`no public RPC known for chain ${chainId}`);
  const data = encodeFunctionData({ abi: ANCHORS_ABI, functionName: "anchors", args: [keccak256(toBytes(dealId))] });
  const res = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data }, "latest"] }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  const [finalHash, refereeHash, blockTime, writer] = decodeFunctionResult({ abi: ANCHORS_ABI, functionName: "anchors", data: j.result });
  return { finalHash: finalHash.slice(2), refereeHash: refereeHash.slice(2), blockTime: Number(blockTime), writer };
}

export async function verifyReceipt(r: Receipt, publishedRefereeHash = REFEREE_HASH, opts: { onchain?: boolean } = {}): Promise<Check[]> {
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

  // 3. Verify each side's requested rounds and the effective lower limit.
  const dealOpen = find(log, "deal.open")[0]?.payload as { maxRounds?: number; buyerMaxRounds?: number; sellerMaxRounds?: number; roundPolicy?: string } | undefined;
  if (dealOpen?.roundPolicy === "blackbox/mutual-min-3") {
    const closedRound = find(log, "deal.closed")[0]?.payload as { round?: number } | undefined;
    const roundEvents = find(log, "round.closed");
    const noDeal = r.outcome?.status === "no_deal";
    const buyerRounds = Number(dealOpen.buyerMaxRounds);
    const sellerRounds = Number(dealOpen.sellerMaxRounds);
    const expectedRounds = Math.min(buyerRounds, sellerRounds, 3);
    const policyOk = [buyerRounds, sellerRounds].every((n) => Number.isInteger(n) && n >= 1 && n <= 3) && dealOpen.maxRounds === expectedRounds && roundEvents.length >= 1 && roundEvents.length <= expectedRounds && (noDeal ? roundEvents.length === expectedRounds : Number(closedRound?.round) === roundEvents.length && Number(closedRound?.round) <= expectedRounds);
    checks.push({ id: "round-policy", label: "Negotiation obeyed both round limits", ok: policyOk, detail: policyOk ? `Buyer requested ${buyerRounds}, seller requested ${sellerRounds}; lower limit ${expectedRounds}. Recorded ${roundEvents.length} round(s).` : `Buyer=${dealOpen.buyerMaxRounds}, seller=${dealOpen.sellerMaxRounds}, effective=${dealOpen.maxRounds}, recorded=${roundEvents.length}, closedRound=${closedRound?.round ?? "none"}.` });
  } else if (dealOpen?.roundPolicy === "blackbox/max-3") {
    const closedRound = find(log, "deal.closed")[0]?.payload as { round?: number } | undefined;
    const roundEvents = find(log, "round.closed");
    const noDeal = r.outcome?.status === "no_deal";
    const policyOk = dealOpen.maxRounds === 3 && roundEvents.length >= 1 && roundEvents.length <= 3 && (noDeal ? roundEvents.length === 3 : Number(closedRound?.round) === roundEvents.length && Number(closedRound?.round) <= 3);
    checks.push({ id: "round-policy", label: "Negotiation obeyed the three-round maximum", ok: policyOk, detail: policyOk ? `${roundEvents.length} round(s) recorded; protocol maximum is 3.` : `Recorded maxRounds=${dealOpen.maxRounds}, rounds=${roundEvents.length}, closedRound=${closedRound?.round ?? "none"}.` });
  }

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

  // 5. Agent identity: every accepted offer carries its agent's signature (newer receipts).
  const ids = find(log, "agent.identity").map((e) => e.payload as unknown as AgentIdentity);
  if (ids.length) {
    const offers = find(log, "offer.accepted").map((e) => e.payload as { side: Side; price: number; quantity: number; round: number; agent?: string; agentSig?: string });
    let bad = 0;
    for (const o of offers) {
      const id = ids.find((x) => x.side === o.side);
      let ok = false;
      try {
        ok = !!id && o.agent === id.runtimeKey && !!o.agentSig &&
          (await verifyMessage({ address: id.runtimeKey as `0x${string}`, message: offerMessage({ dealId: r.dealId, side: o.side, price: o.price, quantity: o.quantity, round: o.round }), signature: o.agentSig as `0x${string}` }));
      } catch { ok = false; }
      if (!ok) bad++;
    }
    // A record that claims a Kite binding must name the runtime key Blackbox registered for that DID.
    const badBinding = ids.filter((x) => x.binding?.status === "bound" && !(x.side in KITE_AGENTS && KITE_AGENTS[x.side as Side].runtimeKey.toLowerCase() === String(x.runtimeKey).toLowerCase() && x.kiteAgent?.did === KITE_AGENTS[x.side as Side].did));
    const ok = ids.length === 2 && bad === 0 && badBinding.length === 0;
    const bindNote = ids.every((x) => x.binding?.status === "bound")
      ? `Keys are the runtime keys bound to Kite agents ${ids.map((x) => x.kiteAgent?.did).join(" and ")}.`
      : ids.some((x) => x.kiteAgent) ? `Kite agents: ${ids.map((x) => `${x.side} ${x.kiteAgent?.did ?? "none"} (${x.binding?.status ?? "unbound"})`).join(", ")}.` : "Runtime keys are not bound to Kite agent DIDs.";
    checks.push({
      id: "agent-sigs", label: "Every offer is signed by its own agent's key", ok,
      detail: ok ? `${offers.length} offers. buyer agent ${ids.find((x) => x.side === "buyer")?.runtimeKey}, seller agent ${ids.find((x) => x.side === "seller")?.runtimeKey}. Owners: ${ids[0].owner?.provider ?? "unknown"} ${ids[0].owner?.account}. ${bindNote}` : badBinding.length ? `Claims a Kite binding that does not match the registered runtime key: ${badBinding.map((x) => x.side).join(", ")}.` : `${bad} offer(s) not signed by the agent identity logged at deal open.`,
    });
  } else {
    checks.push({ id: "agent-sigs", label: "Every offer is signed by its own agent's key", ok: null, detail: "Older receipt: recorded before agents signed their offers." });
  }

  // 6. Settlement
  const sessE = find(log, "settle.session")[0]?.payload as { session?: SessionIntent; delegation?: Delegation; budgetReveal?: BudgetReveal; simulated?: boolean } | undefined;
  const payE = find(log, "settle.payment")[0]?.payload as unknown as (PaymentAttempt & { mode?: string; simulated?: boolean }) | undefined;
  const mandE = find(log, "mandate.open")[0]?.payload as { budgetCommitment?: BudgetCommitment } | undefined;
  const commitBeforeOffers = (() => {
    const m = log.findIndex((e) => e.kind === "mandate.open");
    const firstOffer = log.findIndex((e) => e.kind.startsWith("offer."));
    return m !== -1 && (firstOffer === -1 || m < firstOffer);
  })();
  if (!closed) {
    checks.push({ id: "caps", label: "Payment session capped", ok: null, detail: "No deal, nothing to settle." });
  } else if (!sessE?.session) {
    checks.push({ id: "caps", label: "Payment session capped", ok: false, detail: "No settlement session in the log." });
  } else {
    const ss = sessE.session;
    const sim = ss.mode === "mock" || payE?.mode === "mock" || sessE.simulated === true;
    const total = Number(closed.total).toFixed(6);
    const ttl = (Date.parse(ss.expiresAt) - Date.parse(ss.createdAt)) / 1000;
    if (mandE?.budgetCommitment) {
      const rv = sessE.budgetReveal;
      const revealOk = !!rv && checkBudgetReveal(mandE.budgetCommitment, rv);
      const within = !!rv && Number(total) <= Number(rv.budget) + 1e-9;
      const capsOk = revealOk && ss.maxTotalAmount === rv!.budget && ss.maxAmountPerTx === rv!.budget && ttl > 0 && ttl <= 900;
      checks.push({ id: "budget", label: "Your spending limit was set before any offer", ok: revealOk && commitBeforeOffers, detail: revealOk ? `Limit ${rv!.budget} USDC, committed at deal open, revealed at settlement, hashes to its commitment.` : "Revealed limit does not match the commitment made at deal open." });
      checks.push({ id: "caps", label: "Payment session capped at your spending limit", ok: capsOk, detail: `per-tx ${ss.maxAmountPerTx}, total ${ss.maxTotalAmount}, expires after ${Math.round(ttl / 60)} min. Your limit ${rv?.budget ?? "?"}.` });
      checks.push({ id: "within-budget", label: "Deal total stays inside your spending limit", ok: within, detail: `${total} <= ${rv?.budget ?? "?"} USDC` });
    } else {
      const capsOk = ss.maxTotalAmount === total && ss.maxAmountPerTx === total && ttl > 0 && ttl <= 900;
      checks.push({ id: "caps", label: "Payment session capped at the deal amount", ok: capsOk, detail: `per-tx ${ss.maxAmountPerTx}, total ${ss.maxTotalAmount}, expires after ${Math.round(ttl / 60)} min. Deal total ${total}. (Older receipt: no user-set spending limit.)` });
    }
    let sigOk = false;
    try {
      const d = sessE.delegation!;
      sigOk = d.message === canonical(ss) && (await verifyMessage({ address: d.signer as `0x${string}`, message: d.message, signature: d.signature as `0x${string}` }));
    } catch { sigOk = false; }
    checks.push({ id: "delegation", label: "Session delegation signature valid", ok: sigOk, detail: (sim ? "SIMULATED: throwaway demo key, not a Kite passkey. " : "") + (sigOk ? `Signed by ${sessE.delegation?.signer}` : "Signature does not match the session.") });
    const payOk = !!payE && payE.ok && payE.amount === total;
    checks.push({ id: "payment", label: sim ? "Payment — SIMULATED, no real funds moved" : "Payment", ok: payOk, detail: payE ? `${payE.amount} USDC, ${payE.code}${sim ? ". SIMULATED — no real funds moved; the ref is not a transaction." : ""}` : "No payment entry." });
  }

  // 7. Anchor
  if (r.anchor?.status === "anchored") {
    const a = r.anchor;
    if (opts.onchain) {
      try {
        const on = await readAnchor(a.chainId, a.contract, r.dealId);
        const ok = on.blockTime > 0 && on.finalHash === r.finalHash && headOk;
        checks.push({ id: "anchor", label: "Final hash matches the onchain anchor", ok, detail: on.blockTime === 0 ? `Nothing anchored for this deal on ${a.chain}.` : `${ok ? "Matches" : "Does NOT match"} the hash written on ${a.chain} at ${new Date(on.blockTime * 1000).toISOString()}. ${a.explorerUrl}` });
      } catch (e) {
        checks.push({ id: "anchor", label: "Final hash matches the onchain anchor", ok: null, detail: `Couldn't reach ${a.chain} (${(e as Error).message}). Check by hand: ${a.explorerUrl}` });
      }
    } else {
      checks.push({ id: "anchor", label: "Final hash anchored onchain", ok: a.finalHash === r.finalHash && headOk, detail: `${a.chain}: ${a.explorerUrl} (not read from chain in this check)` });
    }
  } else {
    checks.push({ id: "anchor", label: "Final hash anchored onchain", ok: null, detail: "Not anchored yet." });
  }
  return checks;
}

export type EntryAudit = {
  seq: number;
  kind: LogEntry["kind"];
  /** ok: hash recomputes and links; broken: first entry that fails; after: follows a broken entry, can't be trusted */
  hash: "ok" | "broken" | "after";
  /** Result of re-running the referee rule that applies to this entry, if any. */
  rule: "ok" | "fail" | null;
  note: string;
};

/**
 * Per-entry audit: recomputes each entry's hash and link, and re-runs the referee on every
 * offer, refusal, round close, deal close and reveal, so a judge sees exactly which line fails.
 */
export function auditEntries(log: LogEntry[]): EntryAudit[] {
  const chain = verifyChain(log);
  const open = log.find((e) => e.kind === "deal.open")?.payload as { quantity?: number; maxRounds?: number } | undefined;
  const terms = { quantity: Number(open?.quantity), maxRounds: Number(open?.maxRounds) };
  const commits = log.filter((e) => e.kind === "commit").map((e) => e.payload as unknown as Commitment);
  let state: RefereeState = initialState();
  let accepted: Record<Side, Offer | null> = { buyer: null, seller: null };
  return log.map((e, i) => {
    const hash: EntryAudit["hash"] = chain.ok || chain.brokenAt === null || i < chain.brokenAt ? "ok" : i === chain.brokenAt ? "broken" : "after";
    const p = e.payload as Record<string, unknown>;
    let rule: EntryAudit["rule"] = null;
    let note = "";
    try {
      if (e.kind === "offer.accepted") {
        const v = judge(state, terms, p.side as Side, { price: p.price, quantity: p.quantity, round: p.round });
        rule = v.accepted ? "ok" : "fail";
        note = v.accepted ? "referee accepts this offer" : `referee would refuse: ${v.reason}`;
        if (v.accepted) accepted[p.side as Side] = v.offer;
      } else if (e.kind === "offer.rejected" && /moved backwards/.test(String(p.reason))) {
        const price = Number(p.attempted ?? p.preview);
        const v = judge(state, terms, p.side as Side, { price, quantity: terms.quantity, round: state.round });
        rule = !v.accepted && v.reason === p.reason ? "ok" : "fail";
        note = rule === "ok" ? `referee refuses ${price} again: ${"reason" in v ? v.reason : ""}` : "referee would NOT refuse this offer";
      } else if (e.kind === "offer.blocked" || e.kind === "offer.rejected") {
        rule = /^(blocked|rejected): /.test(String(p.reason)) ? "ok" : "fail";
        note = "refusal recorded; raw text is sealed, so only the reason is public";
      } else if (e.kind === "round.closed") {
        const next = closeRound(state, terms, accepted.buyer, accepted.seller);
        const ok = next.bid === p.bid && next.ask === p.ask && (next.status === "open" ? p.status === "open" : next.status === p.status) && state.round === Number(p.round);
        rule = ok ? "ok" : "fail";
        note = ok ? `bid ${next.bid ?? "-"} / ask ${next.ask ?? "-"} / ${next.status}` : `replay gives bid ${next.bid} ask ${next.ask} ${next.status}`;
        state = next; accepted = { buyer: null, seller: null };
      } else if (e.kind === "deal.closed") {
        const ok = state.status === "closed" && state.price === p.unitPrice;
        rule = ok ? "ok" : "fail";
        note = ok ? `midpoint ${state.price}` : `replay price ${state.price ?? "none"}, log says ${p.unitPrice}`;
      } else if (e.kind === "reveal") {
        const c = commits.find((x) => x.side === p.side);
        const ok = !!c && checkReveal(c, p as unknown as Reveal);
        rule = ok ? "ok" : "fail";
        note = ok ? "hashes to its commitment" : "does not match its commitment";
      }
    } catch (err) {
      rule = "fail"; note = (err as Error).message;
    }
    if (hash !== "ok") note = (hash === "broken" ? "hash no longer matches this entry. " : "after a broken entry. ") + note;
    return { seq: e.seq, kind: e.kind, hash, rule, note };
  });
}

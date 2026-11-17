import { verifyMessage, encodeFunctionData, decodeFunctionResult, keccak256, toBytes } from "viem";
import { canonical } from "./canonical";
import { verifyChain, type LogEntry } from "./chain";
import { checkReveal, priceWithinLimits, type Commitment, type Reveal } from "./commit";
import { replay, initialState, judge, closeRound, type RefereeState, type Side } from "./referee";
import type { Offer } from "./schema";
import { roundsFromLog, type Receipt } from "./receipt";
import { REFEREE_HASH, LEGACY_REFEREE_HASHES } from "./referee-hash.generated";
import { evaluateSettlementPreflight, type SettlementPreflight } from "./referee-security";
import { checkBudgetReveal, KITE_PASSKEY_SCHEME, type SessionIntent, type Delegation, type PaymentAttempt, type BudgetCommitment, type BudgetReveal } from "./settle";
import { offerMessage, KITE_AGENTS, type AgentIdentity } from "./identity";
import { verifyUsdcTransfer, usdcToAtomic } from "./solana-verify";
import { BLACKBOX_ANCHOR_SOLANA, verifyMemoAnchor } from "./solana-memo";
import kiteTestnetDeployment from "../../contracts/deployment.kite-testnet.json";

export type Check = { id: string; label: string; ok: boolean | null; detail: string };

function find(log: LogEntry[], kind: LogEntry["kind"]) {
  return log.filter((e) => e.kind === kind);
}

function expectedSecurityPreflight(log: LogEntry[], state: RefereeState, receiptBudget?: string): SettlementPreflight | null {
  const closed = find(log, "deal.closed")[0]?.payload as { unitPrice?: number; total?: number } | undefined;
  const open = find(log, "deal.open")[0]?.payload as { quantity?: number } | undefined;
  const reveals = find(log, "reveal").map((e) => e.payload as unknown as Reveal);
  const settlement = find(log, "settle.session")[0]?.payload as { budgetReveal?: { budget?: string } } | undefined;
  const budget = Number(receiptBudget ?? settlement?.budgetReveal?.budget);
  if (!closed || !open || !Number.isFinite(budget)) return null;
  return evaluateSettlementPreflight({
    referee: state,
    proposedPrice: typeof closed.unitPrice === "number" ? closed.unitPrice : null,
    proposedTotal: typeof closed.total === "number" ? closed.total : null,
    quantity: Number(open.quantity),
    buyerCeiling: Number(reveals.find((x) => x.side === "buyer")?.limit),
    sellerFloor: Number(reveals.find((x) => x.side === "seller")?.limit),
    spendingCap: budget,
  });
}

function securityPreflightMatches(payload: Record<string, unknown>, expected: SettlementPreflight): boolean {
  const actual = Array.isArray(payload.checks) ? payload.checks as { id?: unknown; ok?: unknown }[] : [];
  return payload.policy === "blackbox/referee-security-v1" &&
    payload.decision === (expected.allowed ? "allow" : "block") &&
    actual.length === expected.checks.length &&
    expected.checks.every((check, i) => actual[i]?.id === check.id && actual[i]?.ok === check.ok);
}

const RPC: Record<number, string> = { 2368: "https://rpc-testnet.gokite.ai/", 2366: "https://rpc.gokite.ai/" };
const KITE_TESTNET_ANCHOR = {
  chainId: kiteTestnetDeployment.chainId,
  chain: kiteTestnetDeployment.chain,
  contract: kiteTestnetDeployment.contract,
  explorer: kiteTestnetDeployment.explorer,
};
function isKiteTestnetAnchor(chainId: number | undefined, contract: string | undefined) {
  return chainId === KITE_TESTNET_ANCHOR.chainId && contract?.toLowerCase() === KITE_TESTNET_ANCHOR.contract.toLowerCase();
}
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

/** Reads the deployed Kite testnet contract only; this function never submits a transaction. */
export async function checkKiteTestnetAnchor(
  receipt: Pick<Receipt, "dealId" | "finalHash" | "referee">,
  headOk: boolean,
): Promise<Check> {
  try {
    const on = await readAnchor(KITE_TESTNET_ANCHOR.chainId, KITE_TESTNET_ANCHOR.contract, receipt.dealId);
    if (on.blockTime === 0) {
      return {
        id: "kite-testnet-anchor", label: "Kite testnet anchor (read-only)", ok: null,
        detail: `No anchor record for this deal on ${KITE_TESTNET_ANCHOR.chain}. This optional testnet check does not affect payment or settlement. ${KITE_TESTNET_ANCHOR.explorer}`,
      };
    }
    const normalize = (hash: string) => hash.replace(/^0x/i, "").toLowerCase();
    const finalHashMatches = normalize(on.finalHash) === normalize(receipt.finalHash);
    const refereeHashMatches = normalize(on.refereeHash) === normalize(receipt.referee.hash);
    const matches = headOk && finalHashMatches && refereeHashMatches;
    return {
      id: "kite-testnet-anchor", label: "Kite testnet anchor (read-only)", ok: matches,
      detail: `${matches ? "Matches" : "Does NOT match"} the receipt's final and referee hashes on ${KITE_TESTNET_ANCHOR.chain} at ${new Date(on.blockTime * 1000).toISOString()}; writer ${on.writer}. This is testnet hash verification only, not USDC settlement. ${KITE_TESTNET_ANCHOR.explorer}`,
    };
  } catch (e) {
    return {
      id: "kite-testnet-anchor", label: "Kite testnet anchor (read-only)", ok: null,
      detail: `Could not read the optional ${KITE_TESTNET_ANCHOR.chain} anchor (${(e as Error).message}). No transaction was submitted. ${KITE_TESTNET_ANCHOR.explorer}`,
    };
  }
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
  const legacyRefOk = publishedRefereeHash === REFEREE_HASH &&
    LEGACY_REFEREE_HASHES.includes(r.referee?.hash ?? "") &&
    JSON.stringify(r.referee?.files) === JSON.stringify(["src/lib/schema.ts", "src/lib/referee.ts"]);
  const refOk = r.referee?.hash === publishedRefereeHash || legacyRefOk;
  checks.push({
    id: "referee", label: "Referee source hash recognized", ok: refOk,
    detail: r.referee?.hash === publishedRefereeHash ? publishedRefereeHash : legacyRefOk
      ? `Legacy referee hash ${r.referee.hash}; this older build predates the Blackbox security preflight.`
      : `Receipt says ${r.referee?.hash ?? "nothing"}, this site publishes ${publishedRefereeHash}.`,
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

  const preflightEntry = find(log, "security.preflight")[0];
  if (preflightEntry) {
    try {
      const state = replay({ quantity: Number(open?.quantity), maxRounds: Number(open?.maxRounds) }, roundsFromLog(log));
      const expected = expectedSecurityPreflight(log, state, r.budget?.limit);
      const payload = preflightEntry.payload as Record<string, unknown>;
      const settlementRecorded = find(log, "settle.session").length > 0;
      const settlementConsistent = expected ? (expected.allowed ? settlementRecorded && !!r.settlement : !settlementRecorded && !r.settlement) : false;
      const ok = !!expected && securityPreflightMatches(payload, expected) && settlementConsistent;
      checks.push({
        id: "preflight", label: "Blackbox settlement preflight replay", ok,
        detail: !expected ? "Could not recompute the preflight from this receipt's deal, reveals, and spending cap."
          : ok ? `${expected.allowed ? "Allowed" : "Blocked"} exactly as the deterministic checks require; payment ${expected.allowed ? "was sent to the settler" : "was not sent to the settler"}.`
          : "The recorded preflight decision, check results, or settlement behavior disagrees with the deterministic rules.",
      });
    } catch (e) {
      checks.push({ id: "preflight", label: "Blackbox settlement preflight replay", ok: false, detail: String((e as Error).message) });
    }
  } else {
    const currentHash = r.referee?.hash === publishedRefereeHash;
    checks.push({
      id: "preflight", label: "Blackbox settlement preflight replay",
      ok: currentHash && r.outcome?.status === "closed" ? false : null,
      detail: r.outcome?.status === "closed" && currentHash ? "Current referee receipt is missing its pre-settlement security record."
        : r.outcome?.status === "closed" ? "Historical receipt predates this preflight." : "Not applicable: no deal closed.",
    });
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
    // A local-key match (including legacy `bound` receipts) must name the expected public runtime key.
    const claimsLocalMatch = (x: AgentIdentity) => x.binding?.status === "local-key-match" || x.binding?.status === "bound";
    const badBinding = ids.filter((x) => claimsLocalMatch(x) && !(x.side in KITE_AGENTS && KITE_AGENTS[x.side as Side].runtimeKey.toLowerCase() === String(x.runtimeKey).toLowerCase() && x.kiteAgent?.did === KITE_AGENTS[x.side as Side].did));
    const ok = ids.length === 2 && bad === 0 && badBinding.length === 0;
    const bindNote = ids.every(claimsLocalMatch)
      ? `Local keys match the registered runtime addresses for Kite agents ${ids.map((x) => x.kiteAgent?.did).join(" and ")}; active Kite Passport binding and runtime connection are not verified.`
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
  const preflightDecision = (find(log, "security.preflight")[0]?.payload as { decision?: string } | undefined)?.decision;
  if (!closed) {
    checks.push({ id: "caps", label: "Payment session capped", ok: null, detail: "No deal, nothing to settle." });
  } else if (!sessE?.session && preflightDecision === "block") {
    checks.push({ id: "caps", label: "Payment session capped", ok: null, detail: "Settlement was stopped by the recorded Blackbox preflight; no payment session was created." });
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
    const realReq = ss.mode === "kite-mainnet" && sessE.simulated === false && sessE.delegation?.scheme === KITE_PASSKEY_SCHEME;
    if (realReq) {
      checks.push({ id: "delegation", label: "Payment approved by the owner's passkey in Kite Passport", ok: null, detail: "Real payment: the approval is a Kite Passport passkey ceremony at payment time, not an in-app key. The proof is the on-chain transfer below." });
      const p = r.onchainPayment;
      const payReqOk = !!payE && payE.amount === total && payE.code === "awaiting_owner_approval";
      if (!p) {
        checks.push({ id: "payment", label: "Real payment on Solana mainnet", ok: null, detail: payReqOk ? `${total} USDC requested from the buyer's Kite Passport to ${ss.payee}. Not paid yet (no transaction recorded with this receipt).` : "Payment request does not match the deal total." });
      } else {
        const matches = payReqOk && p.recipient === ss.payee && p.amount === total;
        if (!matches) {
          checks.push({ id: "payment", label: "Real payment on Solana mainnet", ok: false, detail: `Recorded transfer (${p.amount} USDC to ${p.recipient}) does not match the sealed request (${total} USDC to ${ss.payee}).` });
        } else if (opts.onchain) {
          try {
            const c = await verifyUsdcTransfer({ signature: p.signature, recipient: p.recipient, amountAtomic: usdcToAtomic(p.amount) });
            const live = c.ok ? `${p.amount} USDC reached ${p.recipient} (re-read live from Solana mainnet, ${c.confirmationStatus}). ${p.explorerUrl}` : `${c.reason} ${p.explorerUrl}`;
            checks.push({ id: "payment", label: "Real payment on Solana mainnet", ok: c.ok, detail: live });
          } catch (e) {
            checks.push({ id: "payment", label: "Real payment on Solana mainnet", ok: null, detail: `Couldn't reach Solana mainnet (${(e as Error).message}). Check by hand: ${p.explorerUrl}` });
          }
        } else {
          checks.push({ id: "payment", label: "Real payment on Solana mainnet", ok: true, detail: `${p.amount} USDC to ${p.recipient}, verified on Solana mainnet when recorded (not re-read in this check). ${p.explorerUrl}` });
        }
      }
      return finishAnchor(r, checks, headOk, opts);
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

  return finishAnchor(r, checks, headOk, opts);
}

async function finishAnchor(r: Receipt, checks: Check[], headOk: boolean, opts: { onchain?: boolean }): Promise<Check[]> {
  // 7. Anchor
  if (r.anchor?.status === "anchored") {
    const a = r.anchor;
    const solanaMemo = a.chain === "solana-mainnet" || Boolean(a.program) || Boolean(a.memo);
    if (opts.onchain && solanaMemo) {
      try {
        const on = await verifyMemoAnchor({ signature: a.txHash, dealId: r.dealId, finalHash: r.finalHash, writer: a.writer ?? BLACKBOX_ANCHOR_SOLANA });
        const ok = on.ok === true && headOk;
        const when = on.blockTime ? ` at ${new Date(on.blockTime * 1000).toISOString()}` : "";
        checks.push({
          id: "anchor",
          label: "Final hash matches the onchain anchor",
          ok: on.ok === null ? null : ok,
          detail: on.ok === true
            ? `${ok ? "Matches" : "Does NOT match"} the memo written on Solana mainnet${when}. ${a.explorerUrl}`
            : `${on.reason ?? "Could not verify the memo."} ${a.explorerUrl}`,
        });
      } catch (e) {
        checks.push({ id: "anchor", label: "Final hash matches the onchain anchor", ok: null, detail: `Couldn't reach Solana mainnet (${(e as Error).message}). Check by hand: ${a.explorerUrl}` });
      }
    } else if (opts.onchain && a.chainId && a.contract && isKiteTestnetAnchor(a.chainId, a.contract)) {
      checks.push(await checkKiteTestnetAnchor(r, headOk));
    } else if (opts.onchain && a.chainId && a.contract) {
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
    checks.push({ id: "anchor", label: "Final hash anchored onchain", ok: null, detail: r.anchor?.reason ?? "Not anchored yet." });
  }
  const alreadyCheckingKiteTestnet = r.anchor?.status === "anchored" &&
    isKiteTestnetAnchor(r.anchor.chainId, r.anchor.contract);
  if (opts.onchain && !alreadyCheckingKiteTestnet) {
    checks.push(await checkKiteTestnetAnchor(r, headOk));
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
export function auditEntries(log: LogEntry[], receipt?: Pick<Receipt, "budget" | "settlement">): EntryAudit[] {
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
      } else if (e.kind === "security.preflight") {
        const expected = expectedSecurityPreflight(log, state, receipt?.budget?.limit);
        if (!expected) {
          rule = null;
          note = "cannot independently replay without the revealed deal terms and spending cap";
        } else {
          const matches = securityPreflightMatches(p, expected);
          const settlementRecorded = find(log, "settle.session").length > 0;
          const settlementConsistent = expected.allowed
            ? settlementRecorded && (receipt ? !!receipt.settlement : true)
            : !settlementRecorded && (receipt ? !receipt.settlement : true);
          rule = matches && settlementConsistent ? "ok" : "fail";
          note = rule === "ok" ? `${expected.allowed ? "allow" : "block"} matches the deterministic preflight` : "preflight or settlement behavior does not match the deterministic rules";
        }
      }
    } catch (err) {
      rule = "fail"; note = (err as Error).message;
    }
    if (hash !== "ok") note = (hash === "broken" ? "hash no longer matches this entry. " : "after a broken entry. ") + note;
    return { seq: e.seq, kind: e.kind, hash, rule, note };
  });
}

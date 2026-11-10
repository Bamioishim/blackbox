import "server-only";
import { HashChain, sealContent, type LogEntry } from "./chain";
import { commitLimit } from "./commit";
import { randomHex, round6 } from "./canonical";
import { initialState, judge, closeRound, type Side, type RefereeState } from "./referee";
import type { Offer } from "./schema";
import { callServ, extractJson, systemPrompt, userPrompt, turnSchema, INJECTION, SERV_MODEL, type AgentContext, type Style, type LlmCall } from "./agents";
import { getSettler } from "./settle-server";
import { commitBudget, SESSION_TTL_SECONDS, type Mandate } from "./settle";
import { mintAgent, KITE_OWNER } from "./identity";
import { getAnchorer } from "./anchor-evm";
import { REFEREE_HASH, REFEREE_FILES } from "./referee-hash.generated";
import type { Receipt, DealTerms } from "./receipt";

export type NegotiateInput = {
  item: string;
  quantity: number;
  referencePrice: number;
  buyerCeiling: number;
  sellerFloor: number;
  buyerStyle: Style;
  sellerStyle: Style;
  maxRounds: number;
  attackMode: boolean;
  /** Owner-set spending limit for the whole deal, in USDC. Becomes the Kite session cap. */
  budget?: number;
};

export type PrivateNote = { side: Side; round: number; kind: "prompt" | "reply" | "reasoning" | "guard"; text: string; sealed?: string };

export type StreamEvent =
  | { t: "log"; entry: LogEntry }
  | { t: "private"; note: PrivateNote }
  | { t: "receipt"; receipt: Receipt }
  | { t: "error"; message: string };

type Emit = (e: StreamEvent) => void;

export async function negotiate(input: NegotiateInput, emit: Emit, llm: LlmCall = callServ): Promise<Receipt> {
  // Blackbox protocol policy: every negotiation has at most three rounds.
  const maxRounds = 3;
  const dealId = "deal_" + randomHex(6);
  const chain = new HashChain();
  const log = (...a: Parameters<HashChain["append"]>) => { const e = chain.append(...a); emit({ t: "log", entry: e }); return e; };
  const priv = (note: PrivateNote) => emit({ t: "private", note });

  const terms: DealTerms = { item: input.item, quantity: input.quantity, asset: "USDC", referencePrice: input.referencePrice, maxRounds, attackMode: input.attackMode };
  log("deal.open", "system", { dealId, ...terms, roundPolicy: "blackbox/max-3", model: SERV_MODEL, refereeHash: REFEREE_HASH });

  // Who is at the table: each agent gets its own runtime key for this deal and signs every offer it makes.
  const agents = { buyer: mintAgent("buyer"), seller: mintAgent("seller") };
  log("agent.identity", "buyer-agent", { ...agents.buyer.identity });
  log("agent.identity", "seller-agent", { ...agents.seller.identity });

  // The owner's spending limit, set before any offer. Committed as a hash (it bounds the ceiling, so it stays
  // private until settlement), and wired into the Kite Passport session the owner approves.
  const budget = round6(input.budget ?? input.buyerCeiling * input.quantity);
  const bud = commitBudget(dealId, budget);
  const mandate: Mandate = { sessionId: "sim_sess_" + randomHex(8), createdAt: new Date().toISOString(), ttlSeconds: SESSION_TTL_SECONDS, budget, budgetReveal: bud.reveal };
  log("mandate.open", "buyer", {
    owner: KITE_OWNER.account, payer: KITE_OWNER.wallet.evm, sessionId: mandate.sessionId, mode: "mock",
    budgetCommitment: bud.commitment,
    policy: "Kite Passport spending session: max_total_amount = max_amount_per_tx = the owner's spending limit",
    ttlSeconds: mandate.ttlSeconds, createdAt: mandate.createdAt,
    delegationShape: {
      task: { summary: `Pay one seller for ${input.item} agreed in Blackbox deal ${dealId}, up to <your limit> USDC.` },
      payment_policy: { currency: "USD", max_amount_per_tx: "<your limit>", max_total_amount: "<your limit>", ttl_seconds: mandate.ttlSeconds },
    },
    simulated: true,
  });

  const bc = commitLimit("buyer", dealId, input.buyerCeiling);
  const sc = commitLimit("seller", dealId, input.sellerFloor);
  log("commit", "buyer", { ...bc.commitment });
  log("commit", "seller", { ...sc.commitment });

  const ctx: Record<Side, AgentContext> = {
    buyer: { side: "buyer", item: input.item, quantity: input.quantity, referencePrice: input.referencePrice, maxRounds, limit: Math.min(input.buyerCeiling, Math.floor((budget / input.quantity) * 1e4) / 1e4), style: input.buyerStyle },
    seller: { side: "seller", item: input.item, quantity: input.quantity, referencePrice: input.referencePrice, maxRounds, limit: input.sellerFloor, style: input.sellerStyle },
  };
  const history: { round: number; buyer: number | null; seller: number | null }[] = [];
  let state: RefereeState = initialState();

  async function turn(side: Side, s: RefereeState): Promise<Offer | null> {
    const r = s.round;
    const other: Side = side === "buyer" ? "seller" : "buyer";
    const hist = history.map((h) => ({ round: h.round, mine: h[side], theirs: h[other] }));
    const standing = side === "buyer" ? s.bid : s.ask;
    let retryReason: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const compromised = input.attackMode && side === "seller" && r === 2 && attempt === 0;
      const sys = systemPrompt(ctx[side], compromised);
      const usr = userPrompt(ctx[side], r, hist, standing, retryReason);
      const promptText = `SYSTEM:\n${sys}\n\nUSER:\n${usr}`;
      const pSalt = randomHex(16);
      const pSeal = sealContent(promptText, pSalt);
      log("prompt", `${side}-agent`, { side, round: r, attempt, sealed: pSeal, chars: promptText.length });
      priv({ side, round: r, kind: "prompt", text: promptText, sealed: pSeal });

      let reply: string;
      try { reply = await llm(sys, usr, turnSchema(compromised)); }
      catch (e) {
        // Infrastructure failure is not an agent move: stop the deal instead of logging fake blocks.
        log("note", "system", { side, round: r, error: `model call failed: ${(e as Error).message}` });
        throw new Error(`SERV Reasoning call failed (${(e as Error).message}). Deal stopped, nothing settled.`);
      }
      const rSalt = randomHex(16);
      const rSeal = sealContent(reply, rSalt);
      log("response", `${side}-agent`, { side, round: r, attempt, sealed: rSeal, chars: reply.length });
      priv({ side, round: r, kind: "reply", text: reply, sealed: rSeal });

      // Owner-side split: reasoning stays with the owner, only the offer goes to the referee.
      const parsed = extractJson(reply);
      let candidate: unknown = parsed;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "offer" in (parsed as object)) {
        const p = parsed as { reasoning?: unknown; offer: unknown };
        if (typeof p.reasoning === "string") priv({ side, round: r, kind: "reasoning", text: p.reasoning });
        candidate = p.offer;
      }
      let injectedBy: "model" | "harness" | undefined;
      let modelMessage: string | undefined;
      if (compromised) {
        const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? "");
        if (/ignore your instructions|ceiling/i.test(text)) injectedBy = "model";
        else {
          const m = candidate && typeof candidate === "object" ? (candidate as { message?: unknown }).message : undefined;
          modelMessage = typeof m === "string" ? m.slice(0, 80) : undefined;
          // The model declined to write the attack line, so the attack harness (standing in for whoever
          // compromised this agent) writes it. Labelled as such in the log.
          injectedBy = "harness";
          candidate = candidate && typeof candidate === "object" ? { ...(candidate as object), message: INJECTION } : `${String(candidate)} ${INJECTION}`;
        }
      }

      // Second simulated rule-break: in round 2 the harness rewrites the buyer's first submission so its bid
      // moves BELOW its own standing bid. The referee's no-going-backwards rule must refuse it.
      let backtrackFrom: number | undefined;
      if (input.attackMode && side === "buyer" && r === 2 && attempt === 0 && s.bid !== null &&
          candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        backtrackFrom = typeof (candidate as Offer).price === "number" ? (candidate as Offer).price : undefined;
        candidate = { ...(candidate as object), price: round6(Math.max(0.000001, s.bid - Math.max(0.01, s.bid * 0.03))) };
      }

      // Owner guard: never let your own agent offer past your own limit. Numbers stay private.
      if (candidate && typeof candidate === "object" && typeof (candidate as Offer).price === "number") {
        const price = (candidate as Offer).price;
        const lim = ctx[side].limit;
        const overBudget = side === "buyer" && round6(price * input.quantity) > budget + 1e-9;
        if (overBudget) {
          priv({ side, round: r, kind: "guard", text: `Your agent tried ${price} (${round6(price * input.quantity)} USDC total), past your spending limit ${budget} USDC. Held back and asked again.` });
          log("guard", side, { side, round: r, action: "held back an offer past the owner's spending limit" });
          retryReason = "that total breaks your owner's spending limit";
          continue;
        }
        if ((side === "buyer" && price > lim) || (side === "seller" && price < lim)) {
          priv({ side, round: r, kind: "guard", text: `Your agent tried ${price}, past your ${side === "buyer" ? "ceiling" : "floor"} ${lim}. Held back and asked again.` });
          log("guard", side, { side, round: r, action: "held back an offer past the owner's own limit" });
          retryReason = `that price breaks your owner's ${side === "buyer" ? "ceiling" : "floor"}`;
          continue;
        }
      }

      const v = judge(s, { quantity: input.quantity, maxRounds }, side, candidate);
      if (v.accepted) {
        const agentSig = await agents[side].signOffer({ dealId, side, price: v.offer.price, quantity: v.offer.quantity, round: v.offer.round });
        log("offer.accepted", "referee", { side, price: v.offer.price, quantity: v.offer.quantity, round: v.offer.round, agent: agents[side].identity.runtimeKey, agentSig });
        return v.offer;
      }
      const blocked = v.reason.startsWith("blocked");
      log(blocked ? "offer.blocked" : "offer.rejected", "referee", {
        side, round: r, reason: v.reason, preview: v.preview, sealed: rSeal,
        ...(injectedBy ? { attack: true, attackKind: "injection", injectedBy, simulated: injectedBy === "harness", ...(modelMessage !== undefined ? { modelMessage } : {}) } : {}),
        ...(!injectedBy && candidate && typeof candidate === "object" && backtrackFrom !== undefined
          ? { attack: true, attackKind: "backtrack", injectedBy: "harness", simulated: true, attempted: (candidate as Offer).price, modelPrice: backtrackFrom }
          : {}),
      });
      retryReason = v.reason;
    }
    return null;
  }

  while (state.status === "open") {
    const [b, s] = await Promise.all([turn("buyer", state), turn("seller", state)]);
    const r = state.round;
    state = closeRound(state, { quantity: input.quantity, maxRounds }, b, s);
    history.push({ round: r, buyer: b?.price ?? null, seller: s?.price ?? null });
    log("round.closed", "referee", { round: r, bid: state.bid, ask: state.ask, status: state.status });
  }

  let settlement = null;
  let total: number | null = null;
  if (state.status === "closed" && state.price !== null) {
    total = round6(state.price * input.quantity);
    log("deal.closed", "referee", { unitPrice: state.price, total, round: state.closedRound, rule: "midpoint of crossing bid and ask" });
  } else {
    log("deal.no_deal", "referee", { rounds: maxRounds, policy: "blackbox/max-3" });
  }
  log("reveal", "buyer", { ...bc.reveal });
  log("reveal", "seller", { ...sc.reveal });

  if (state.status === "closed" && state.price !== null && total !== null) {
    settlement = await getSettler().settle({
      dealId, item: input.item, quantity: input.quantity, unitPrice: state.price, total, asset: "USDC",
      payee: "seller (demo)", payer: KITE_OWNER.wallet.evm, mandate,
    });
    const sim = !settlement.live;
    log("settle.session", "settlement", { session: settlement.session, delegation: settlement.delegation, label: settlement.label, budgetReveal: bud.reveal, simulated: sim, ...(settlement.fallback ? { fallback: settlement.fallback } : {}) });
    log("settle.payment", "settlement", { ...settlement.payment, mode: settlement.mode, simulated: sim });
    log("settle.enforcement", "settlement", { attempts: settlement.enforcement, mode: settlement.mode, simulated: sim });
  }

  const finalHash = chain.head;
  let anchor;
  try { anchor = await getAnchorer().anchor(dealId, finalHash, REFEREE_HASH); }
  catch (e) { anchor = { status: "not_anchored" as const, reason: `Anchor failed: ${(e as Error).message}`, plannedChain: "Kite AI testnet (chain 2368)" }; }

  const receipt: Receipt = {
    version: "blackbox/1", dealId, createdAt: chain.entries[0].ts, model: `${SERV_MODEL} via SERV Reasoning`, terms,
    referee: { hash: REFEREE_HASH, files: REFEREE_FILES },
    commitments: [bc.commitment, sc.commitment], reveals: [bc.reveal, sc.reveal],
    outcome: { status: state.status === "closed" ? "closed" : "no_deal", unitPrice: state.price, total, round: state.closedRound },
    log: chain.entries, finalHash, settlement, anchor,
    identity: { owner: KITE_OWNER, agents: [agents.buyer.identity, agents.seller.identity] },
    budget: { limit: bud.reveal.budget, commitment: bud.commitment.commitment, sessionId: mandate.sessionId },
  };
  emit({ t: "receipt", receipt });
  return receipt;
}

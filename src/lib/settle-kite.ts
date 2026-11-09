/**
 * Kite Passport adapter. Not used in the deployed demo (SETTLE_MODE is unset there).
 * Needs: kpass CLI installed and logged in (docs.gokite.ai/passport/install), a funded Passport wallet
 * with USDC, and the owner approving the session with their passkey.
 *
 * The owner's spending limit goes straight into the delegation the owner approves:
 *   payment_policy.max_total_amount = max_amount_per_tx = budget   (see kiteDelegation in settle.ts)
 * so Kite's backend, not Blackbox, refuses anything past it.
 *
 * Untested end to end: no USDC has been funded yet. If this adapter can't confirm a payment, getSettler()
 * falls back to the SIMULATED settler and says so on screen, in the receipt and in the log.
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildSessionIntent, kiteDelegation, type SettleInput, type Settlement, type Settler } from "./settle";
import { fmtAmount } from "./canonical";

const run = promisify(execFile);

// execFile passes argv directly (no shell), so the delegation JSON can't be interpreted by a shell.
async function kpass(args: string[]) {
  const { stdout } = await run("kpass", [...args, "--output", "json", "--no-interactive"], { timeout: 120_000 });
  return JSON.parse(stdout);
}

export class KitePassportSettler implements Settler {
  readonly mode = "kite-mainnet" as const;
  async settle(deal: SettleInput): Promise<Settlement> {
    if (!deal.mandate) throw new Error("no spending limit set");
    const intent = buildSessionIntent(deal, this.mode);
    const total = fmtAmount(deal.total);
    // 1. Separate session capped at the owner's spending limit; the owner approves it with their passkey.
    const delegation = kiteDelegation(deal.dealId, deal.item, deal.mandate.budget, intent.ttlSeconds);
    const req = await kpass(["session", "create", "--separate", "--no-browser", "--delegation", JSON.stringify(delegation)]);
    const sessionId = String(req?.session_id ?? req?.session?.id ?? "");
    if (!sessionId) {
      // Approval is pending (req.approval_url). A deal can't wait on a passkey inside one request.
      return {
        mode: this.mode, live: false, simulated: true, label: "Kite session requested, awaiting the owner's passkey. No funds moved.",
        session: { ...intent, sessionId: String(req?.request_id ?? intent.sessionId) },
        delegation: { scheme: "Kite Passport passkey approval (pending)", signer: "", signature: "", message: JSON.stringify(delegation) },
        payment: { label: "Pay the agreed amount", amount: total, ok: false, code: "awaiting_passkey_approval" },
        enforcement: [],
      };
    }
    // 2. Pay the seller from the Passport wallet. Field names are checked against a real response once funded.
    const sent = await kpass(["wallet", "send", "--chain", "base", "--to", deal.payee, "--amount", total, "--asset", "USDC"]);
    const tx = sent?.tx_hash ? String(sent.tx_hash) : undefined;
    return {
      mode: this.mode,
      live: Boolean(tx),
      simulated: !tx,
      label: tx ? "Kite Passport settlement" : "Kite session approved, payment not confirmed. No funds moved.",
      session: { ...intent, sessionId },
      delegation: { scheme: "Kite Passport passkey approval", signer: String(req?.agent_id ?? ""), signature: "", message: JSON.stringify(delegation) },
      payment: { label: "Pay the agreed amount", amount: total, ok: Boolean(tx), code: tx ? "settled" : "payment_not_confirmed", ref: tx },
      enforcement: [],
    };
  }
}

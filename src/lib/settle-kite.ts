/**
 * Kite Passport adapter SKELETON. Not used in the deployed demo.
 * Needs: kpass CLI installed and logged in (docs.gokite.ai/passport/install), a funded Passport
 * wallet with USDC, and the owner approving the session with their passkey via the returned URL.
 * Enable only by setting SETTLE_MODE=kite on a machine where kpass works. Untested end to end.
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildSessionIntent, type SettleInput, type Settlement, type Settler } from "./settle";
import { fmtAmount } from "./canonical";

const run = promisify(execFile);

async function kpass(args: string[]) {
  const { stdout } = await run("kpass", [...args, "--output", "json", "--no-interactive"], { timeout: 120_000 });
  return JSON.parse(stdout);
}

export class KitePassportSettler implements Settler {
  readonly mode = "kite-testnet" as const;
  async settle(deal: SettleInput): Promise<Settlement> {
    const intent = buildSessionIntent(deal, this.mode);
    const total = fmtAmount(deal.total);
    // 1. One-off session: per-tx cap = total cap = agreed amount, short TTL.
    const session = await kpass([
      "agent:session", "create",
      "--task-summary", intent.taskSummary,
      "--max-amount-per-tx", total,
      "--max-total-amount", total,
      "--ttl", `${Math.round(intent.ttlSeconds / 60)}m`,
      "--assets", "USDC",
    ]);
    // 2. Owner approves session.approval_url with their passkey. 3. Pay the seller.
    //    (Field names below are placeholders until checked against a real kpass response.)
    const sent = await kpass(["wallet", "send", "--to", deal.payee, "--amount", total, "--asset", "USDC"]);
    return {
      mode: this.mode,
      live: Boolean(sent?.tx_hash),
      label: sent?.tx_hash ? "Kite testnet settlement" : "Kite session created, payment not confirmed",
      session: { ...intent, sessionId: String(session?.session_id ?? intent.sessionId) },
      delegation: { scheme: "Kite Passport passkey approval", signer: String(session?.agent_id ?? ""), signature: String(session?.delegation ?? ""), message: "" },
      payment: { label: "Pay the agreed amount", amount: total, ok: Boolean(sent?.tx_hash), code: sent?.tx_hash ? "settled" : "pending", ref: sent?.tx_hash },
      enforcement: [],
    };
  }
}

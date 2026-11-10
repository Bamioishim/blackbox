import "server-only";
import { MockKiteSettler, type Settler, type SettleInput, type Settlement } from "./settle";
import { KitePassportSettler } from "./settle-kite";

/**
 * The default settler is SIMULATED.
 *
 * SETTLE_MODE=kite is a guarded placeholder, not a live integration: the
 * Kite adapter deliberately refuses to call the CLI from a Vercel Function
 * because Kite has not published a public HTTP API for app backends. The
 * refusal is recorded as an explicitly labelled simulated fallback.
 *
 * Never mark a payment live without a verifiable transaction hash returned
 * by a supported Kite integration.
 */
export function getSettler(): Settler {
  const mock = new MockKiteSettler();
  if (process.env.SETTLE_MODE !== "kite") return mock;
  const kite = new KitePassportSettler();
  return {
    mode: kite.mode,
    async settle(deal: SettleInput): Promise<Settlement> {
      try {
        const s = await kite.settle(deal);
        if (s.live && s.payment.ok && s.payment.ref) return s;
        return mock.settle(deal, { from: kite.mode, reason: s.payment.code || "payment not confirmed" });
      } catch (e) {
        return mock.settle(deal, { from: kite.mode, reason: (e as Error).message.slice(0, 200) });
      }
    },
  };
}

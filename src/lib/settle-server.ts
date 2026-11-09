import "server-only";
import { MockKiteSettler, type Settler, type SettleInput, type Settlement } from "./settle";
import { KitePassportSettler } from "./settle-kite";

/**
 * Picks the settler. Default is the SIMULATED mock. With SETTLE_MODE=kite it tries the real Kite Passport
 * adapter, and if that throws or doesn't confirm a payment it falls back to the mock, labelled
 * "SIMULATED — no real funds moved" with the reason, never as a real transaction.
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
        return mock.settle(deal, { from: kite.mode, reason: (e as Error).message.slice(0, 160) });
      }
    },
  };
}

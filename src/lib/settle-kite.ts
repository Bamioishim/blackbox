/**
 * Kite Passport live settlement is intentionally disabled in the Vercel app.
 *
 * The currently published Kite Passport developer docs expose the kpass CLI and
 * agent skills, but state that there is no public HTTP API reference for apps.
 * A CLI installed on a developer's laptop is not available inside a Vercel
 * Function, and a user's local Passport login/passkey must never be assumed to
 * exist on the server.
 *
 * Do not shell out to kpass from this server adapter. That would fail in the
 * deployed environment and, worse, the old implementation used undocumented
 * command flags and an incorrect Base-chain assumption.
 *
 * Re-enable live settlement only after Kite publishes/supports a server-side
 * integration contract or an explicitly supported hosted-agent handoff that
 * returns a verifiable transaction hash.
 *
 * Official docs:
 * https://docs.gokite.ai/passport
 * https://docs.gokite.ai/api-reference
 */
import "server-only";
import type { SettleInput, Settlement, Settler } from "./settle";

export class KitePassportSettler implements Settler {
  readonly mode = "kite-mainnet" as const;

  async settle(_deal: SettleInput): Promise<Settlement> {
    throw new Error(
      "Kite Passport live settlement is not enabled: Kite currently documents CLI/agent-skill flows, not a public HTTP API for Vercel apps. No session was created and no funds moved.",
    );
  }
}

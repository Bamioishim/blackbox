/**
 * Who is at the table. Public values only: no keys, no email.
 *
 * Owner: the Kite Passport account that owns both seats in this demo and whose Passport wallet pays.
 * Agents: each deal mints one secp256k1 runtime key per agent (the same key type Kite Passport binds to an
 * agent with `kpass agent init` + `kpass agent bind`). The agent signs every offer it puts on the table, so
 * the verifier can prove which agent made which offer. Binding these keys to a registered Kite agent DID
 * needs the owner to finish Kite onboarding (`kpass agent create`), which hasn't happened yet; every
 * identity record says so.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { canonical } from "./canonical";
import type { Side } from "./referee";

export const KITE_OWNER = {
  provider: "kite-passport" as const,
  /** Kite Passport user id, shortened. The account email is never shown. */
  account: "user_01a1c106…c299ddce5a17",
  /** Passport-managed wallets (no exportable key; sends need the owner's passkey). */
  wallet: {
    evm: "0x39A6C46b79b6cA43c8cd0B5D4f713C06e4B00f4D",
    solana: "ABVbrFkJoTEtBHvh7AiSBH11HLo5XbwSU9vJoUajZahN",
  },
  backend: "passport.prod.gokite.ai",
};

export type AgentOwner = { provider: "kite-passport" | "blackbox-account"; account: string; wallet: { evm: string; solana: string }; backend: string };

export type AgentIdentity = {
  side: Side;
  agentRef: string;
  runtimeKey: string; // address of this deal's runtime key
  keyScheme: "secp256k1 / EIP-191";
  owner: AgentOwner;
  binding: { status: "unbound"; note: string };
};

export type AgentSigner = { identity: AgentIdentity; signOffer: (o: OfferSigPayload) => Promise<string> };
export type OfferSigPayload = { dealId: string; side: Side; price: number; quantity: number; round: number };

export function offerMessage(o: OfferSigPayload): string {
  return canonical({ scheme: "blackbox-offer/1", ...o });
}

export function mintAgent(side: Side, owner: AgentOwner = KITE_OWNER): AgentSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  const identity: AgentIdentity = {
    side,
    agentRef: `blackbox-${side}`,
    runtimeKey: account.address,
    keyScheme: "secp256k1 / EIP-191",
    owner,
    binding: {
      status: "unbound",
      note: "Per-deal runtime key, the key type Kite Passport binds to an agent. Not yet bound to a registered Kite agent DID (needs the owner to finish Kite onboarding).",
    },
  };
  return { identity, signOffer: (o) => account.signMessage({ message: offerMessage(o) }) };
}

export const short = (a: string, head = 6, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

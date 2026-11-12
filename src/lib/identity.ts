/**
 * Who is at the table. Public values only: no keys, no email.
 *
 * Owner: the Kite Passport account that owns both seats in this demo and whose Passport wallet pays.
 * Agents: the buyer and seller are registered Kite Passport identity agents (`kpass agent create`), each with
 * its own DID. Each has a secp256k1 runtime key bound to that DID with an owner-minted token
 * (`kpass agent init` + `kpass agent bind --token`, binding active). When the server holds the bound key
 * (BLACKBOX_BUYER_AGENT_KEY / BLACKBOX_SELLER_AGENT_KEY), the agent signs every offer with it; otherwise it
 * falls back to a per-deal key and the record says it is unbound. Either way the verifier can prove which
 * agent made which offer.
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

/** Registered Kite Passport identity agents (public values from `kpass agent create` / `kpass agent bind`). */
export const KITE_AGENTS = {
  buyer: {
    did: "did:kite:auto-57j6tv:blackbox-buyer",
    agentId: "agt_01a1d18a-ef16-7a3e-99e4-2df23f86a71d",
    keyId: "did:kite:auto-57j6tv:blackbox-buyer#jkt:c6223a9610a9a371",
    runtimeKey: "0xA6e1241319fAe02e1Ce242d1A7b2A7cCDDbF33Bd",
    visibility: "listed",
  },
  seller: {
    did: "did:kite:auto-57j6tv:blackbox-seller",
    agentId: "agt_01a1d18b-2075-7507-8f69-54ceab133335",
    keyId: "did:kite:auto-57j6tv:blackbox-seller#jkt:0e5e979daeacc464",
    runtimeKey: "0xe7EE5cdb568ECDdC77dcd884bb8202E6c786e8b3",
    visibility: "unlisted",
  },
} as const;

export type KiteAgentRef = { did: string; agentId: string; keyId: string };

export type AgentOwner = { provider: "kite-passport" | "blackbox-account"; account: string; wallet: { evm: string; solana: string }; backend: string };

export type AgentIdentity = {
  side: Side;
  agentRef: string;
  runtimeKey: string; // address of the key that signs this agent's offers
  keyScheme: "secp256k1 / EIP-191";
  owner: AgentOwner;
  /** The registered Kite Passport agent this seat belongs to (Kite-owned seats only). */
  kiteAgent?: KiteAgentRef;
  binding: { status: "bound" | "unbound"; note: string; method?: "kite-token" };
};

export type AgentSigner = { identity: AgentIdentity; signOffer: (o: OfferSigPayload) => Promise<string> };
export type OfferSigPayload = { dealId: string; side: Side; price: number; quantity: number; round: number };

export function offerMessage(o: OfferSigPayload): string {
  return canonical({ scheme: "blackbox-offer/1", ...o });
}

function boundKey(side: Side): `0x${string}` | null {
  const raw = (typeof process !== "undefined" ? process.env[`BLACKBOX_${side.toUpperCase()}_AGENT_KEY`] : undefined)?.trim();
  if (!raw) return null;
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? hex : null;
}

export function mintAgent(side: Side, owner: AgentOwner = KITE_OWNER): AgentSigner {
  const reg = owner.provider === "kite-passport" ? KITE_AGENTS[side] : undefined;
  const held = reg ? boundKey(side) : null;
  let account = privateKeyToAccount(held ?? generatePrivateKey());
  // Only claim the binding when the held key really is the one registered with Kite.
  const bound = !!reg && !!held && account.address.toLowerCase() === reg.runtimeKey.toLowerCase();
  if (held && !bound) account = privateKeyToAccount(generatePrivateKey());
  const identity: AgentIdentity = {
    side,
    agentRef: `blackbox-${side}`,
    runtimeKey: account.address,
    keyScheme: "secp256k1 / EIP-191",
    owner,
    ...(reg ? { kiteAgent: { did: reg.did, agentId: reg.agentId, keyId: reg.keyId } } : {}),
    binding: bound
      ? { status: "bound", method: "kite-token", note: `Runtime key bound to ${reg!.did} in Kite Passport (owner-minted bind token, binding active).` }
      : { status: "unbound", note: reg ? `Per-deal key. The agent is registered as ${reg.did}, but this deal's key is not its bound runtime key.` : "Per-deal runtime key for this account's agent; not bound to a Kite agent DID." },
  };
  return { identity, signOffer: (o) => account.signMessage({ message: offerMessage(o) }) };
}

export const short = (a: string, head = 6, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

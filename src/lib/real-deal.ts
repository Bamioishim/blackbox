import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { fmtAmount } from "./canonical";
import { usdcToAtomic } from "./solana-verify";

/**
 * Real marketplace settlement: Kite Passport, USDC on Solana mainnet.
 *
 * Kite Passport has no server API for app backends; wallet sends are created with the kpass CLI
 * and approved by the wallet owner with a passkey. So the Vercel app never holds Kite credentials:
 *  1. the buyer opts in, the deal closes, and the sealed log records a payment REQUEST (not a payment);
 *  2. a settlement worker run by the operator (scripts/settle-worker.mjs, where kpass is signed in)
 *     creates the Kite wallet send and posts the passkey approval link back here;
 *  3. after the owner approves, the worker posts the transaction signature; this server reads it
 *     from Solana mainnet and only marks the deal settled if exactly the agreed USDC reached the
 *     seller's payout address after the request was made. Then the asset moves to the buyer.
 */

export const REAL_STATUSES = ["pending_deal", "requested", "awaiting_approval", "settled", "failed", "cancelled"] as const;
export type RealStatus = (typeof REAL_STATUSES)[number];

export function realSettleMax(): number {
  const v = Number(process.env.REAL_SETTLE_MAX_USDC ?? "1");
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Buyer accounts allowed to request a real payment (comma-separated emails). Unset = feature off. */
export function realSettleAllowed(email: string): boolean {
  const list = (process.env.REAL_SETTLE_BUYER_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

let schemaReady: Promise<void> | null = null;
export function ensureRealSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db();
      await sql`CREATE TABLE IF NOT EXISTS bb_payout_wallets (
        user_id text PRIMARY KEY,
        solana_address text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS bb_real_settlements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        negotiation_id uuid NOT NULL UNIQUE,
        listing_id uuid NOT NULL,
        buyer_id text NOT NULL,
        seller_id text NOT NULL,
        chain text NOT NULL DEFAULT 'solana',
        asset text NOT NULL DEFAULT 'USDC',
        mint text NOT NULL DEFAULT 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        recipient text NOT NULL,
        amount text,
        amount_atomic text,
        status text NOT NULL DEFAULT 'pending_deal',
        attempts integer NOT NULL DEFAULT 0,
        approval_url text,
        approval_expires_at timestamptz,
        kite_request_id text,
        requested_at timestamptz,
        signature text UNIQUE,
        onchain jsonb,
        buyer_asset_id uuid,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        settled_at timestamptz
      )`;
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

export async function payoutAddressFor(userId: string): Promise<string | null> {
  await ensureRealSchema();
  const rows = await db()`SELECT solana_address FROM bb_payout_wallets WHERE user_id=${String(userId)} LIMIT 1`;
  return (rows[0] as { solana_address: string } | undefined)?.solana_address ?? null;
}

export async function settlementForNegotiation(negotiationId: string) {
  await ensureRealSchema();
  const rows = await db()`SELECT * FROM bb_real_settlements WHERE negotiation_id=${negotiationId}::uuid LIMIT 1`;
  return (rows[0] as Record<string, any> | undefined) ?? null;
}

/** Called when the sealed negotiation finishes. */
export async function markNegotiationOutcome(negotiationId: string, total: number | null) {
  await ensureRealSchema();
  const sql = db();
  if (total !== null && total > 0 && total <= realSettleMax() + 1e-9) {
    await sql`UPDATE bb_real_settlements SET status='requested', amount=${fmtAmount(total)}, amount_atomic=${usdcToAtomic(total).toString()}, requested_at=now(), updated_at=now()
      WHERE negotiation_id=${negotiationId}::uuid AND status='pending_deal'`;
  } else {
    await sql`UPDATE bb_real_settlements SET status='cancelled', error=${total === null ? "No deal, nothing to pay." : "Deal total is above the real-settlement cap."}, updated_at=now()
      WHERE negotiation_id=${negotiationId}::uuid AND status='pending_deal'`;
  }
}

export function workerAuthorized(req: Request): boolean {
  const secret = process.env.SETTLEMENT_WORKER_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(secret).digest();
  return got.length > 0 && timingSafeEqual(a, b);
}

/** Public, display-safe view of a settlement row for the buyer or seller. */
export function publicSettlement(row: Record<string, any> | null, viewerId: string) {
  if (!row) return null;
  const isBuyer = String(row.buyer_id) === String(viewerId);
  return {
    id: row.id,
    status: row.status as RealStatus,
    chain: "solana-mainnet",
    asset: "USDC",
    amount: row.amount ?? null,
    recipient: row.recipient,
    approvalUrl: isBuyer && row.status === "awaiting_approval" ? row.approval_url : null,
    approvalExpiresAt: isBuyer && row.status === "awaiting_approval" ? row.approval_expires_at : null,
    signature: row.signature ?? null,
    explorerUrl: row.signature ? `https://solscan.io/tx/${row.signature}` : null,
    onchain: row.onchain ?? null,
    error: row.status === "failed" || row.status === "cancelled" ? row.error : null,
    settledAt: row.settled_at ?? null,
  };
}

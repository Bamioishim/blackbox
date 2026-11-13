import { db } from "@/lib/db";

/**
 * Public receipt lookup for the verifier. Returns the stored marketplace
 * receipt for a deal id, attaching the on-chain payment record when the
 * deal settled for real. No account required.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^deal_[a-z0-9_-]{6,40}$/.test(id)) return Response.json({ error: "bad deal id" }, { status: 400 });
  try {
    const rows = await db()`SELECT n.receipt, r.onchain
      FROM bb_negotiations n
      LEFT JOIN bb_real_settlements r ON r.negotiation_id=n.id
      WHERE n.receipt->>'dealId'=${id}
      LIMIT 1`;
    const row = rows[0] as { receipt?: any; onchain?: any } | undefined;
    if (!row?.receipt) return Response.json({ error: "not found" }, { status: 404 });
    const receipt = row.receipt;
    if (row.onchain && !receipt.onchainPayment) receipt.onchainPayment = row.onchain;
    return Response.json(receipt, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=300" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "unavailable" }, { status: 502 });
  }
}

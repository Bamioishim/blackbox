import { db } from "@/lib/db";
import { ensureRealSchema, workerAuthorized, realSettleMax } from "@/lib/real-deal";
import { verifyUsdcTransfer, isSolanaSignature, atomicToUsdc } from "@/lib/solana-verify";
import { USDC_MINT_SOLANA } from "@/lib/real-settlement";
import type { OnchainPayment } from "@/lib/receipt";

export const maxDuration = 60;

const deny = () => Response.json({ error: "unauthorized" }, { status: 401 });

/** Payments waiting for the operator's settlement worker. */
export async function GET(req: Request) {
  if (!workerAuthorized(req)) return deny();
  await ensureRealSchema();
  const rows = await db()`SELECT r.id,r.negotiation_id,r.status,r.amount,r.amount_atomic,r.recipient,r.chain,r.asset,r.attempts,r.kite_request_id,r.approval_expires_at,r.requested_at,
      u.email AS buyer_email, n.receipt->>'dealId' AS deal_id, n.receipt->'terms'->>'item' AS item
    FROM bb_real_settlements r JOIN bb_negotiations n ON n.id=r.negotiation_id LEFT JOIN bb_users u ON u.id::text=r.buyer_id
    WHERE r.status IN ('requested','awaiting_approval') ORDER BY r.requested_at ASC LIMIT 20`;
  return Response.json({ payments: rows, cap: realSettleMax() });
}

function okApprovalUrl(u: string) {
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === "gokite.ai" || x.hostname.endsWith(".gokite.ai")); } catch { return false; }
}

export async function POST(req: Request) {
  if (!workerAuthorized(req)) return deny();
  await ensureRealSchema();
  const sql = db();
  const b = (await req.json().catch(() => null)) as Record<string, any> | null;
  const id = String(b?.id ?? "");
  const action = String(b?.action ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const rows = await sql`SELECT * FROM bb_real_settlements WHERE id=${id}::uuid LIMIT 1`;
  const row = rows[0] as Record<string, any> | undefined;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  if (action === "approval") {
    const approvalUrl = String(b?.approvalUrl ?? ""), kiteRequestId = String(b?.kiteRequestId ?? "").slice(0, 120);
    if (!okApprovalUrl(approvalUrl) || !kiteRequestId) return Response.json({ error: "approvalUrl must be an https gokite.ai link, with a kiteRequestId" }, { status: 400 });
    const exp = b?.expiresAt ? new Date(String(b.expiresAt)) : null;
    const up = await sql`UPDATE bb_real_settlements SET status='awaiting_approval', approval_url=${approvalUrl}, kite_request_id=${kiteRequestId},
      approval_expires_at=${exp && Number.isFinite(exp.getTime()) ? exp.toISOString() : null}, attempts=attempts+1, error=NULL, updated_at=now()
      WHERE id=${id}::uuid AND status IN ('requested','awaiting_approval') RETURNING id,status`;
    return up.length ? Response.json({ ok: true, status: "awaiting_approval" }) : Response.json({ error: `cannot attach approval in status ${row.status}` }, { status: 409 });
  }
  if (action === "expired") {
    const up = await sql`UPDATE bb_real_settlements SET status='requested', approval_url=NULL, approval_expires_at=NULL, error=${String(b?.reason ?? "Approval link expired; a new one is being created.").slice(0, 300)}, updated_at=now()
      WHERE id=${id}::uuid AND status='awaiting_approval' RETURNING id`;
    return Response.json({ ok: up.length > 0, status: up.length ? "requested" : row.status });
  }
  if (action === "failed" || action === "cancel") {
    const up = await sql`UPDATE bb_real_settlements SET status=${action === "failed" ? "failed" : "cancelled"}, approval_url=NULL, error=${String(b?.reason ?? (action === "failed" ? "Payment failed." : "Cancelled by the operator.")).slice(0, 300)}, updated_at=now()
      WHERE id=${id}::uuid AND status IN ('pending_deal','requested','awaiting_approval') RETURNING id,status`;
    return Response.json({ ok: up.length > 0, status: up.length ? (up[0] as { status: string }).status : row.status });
  }
  if (action !== "confirm") return Response.json({ error: "unknown action" }, { status: 400 });

  // confirm: the on-chain transfer must match the sealed request exactly
  const signature = String(b?.signature ?? "").trim();
  const dryRun = b?.dryRun === true;
  if (!isSolanaSignature(signature)) return Response.json({ error: "bad signature" }, { status: 400 });
  if (row.status === "settled") return Response.json({ ok: row.signature === signature, status: "settled", signature: row.signature }, { status: row.signature === signature ? 200 : 409 });
  if (!["requested", "awaiting_approval"].includes(row.status) || !row.amount_atomic) return Response.json({ error: `cannot settle in status ${row.status}` }, { status: 409 });
  const used = await sql`SELECT id FROM bb_real_settlements WHERE signature=${signature} LIMIT 1`;
  if (used.length) return Response.json({ error: "That transaction already settled another deal." }, { status: 409 });
  const amountAtomic = BigInt(dryRun && b?.dryRunAmountAtomic ? String(b.dryRunAmountAtomic) : String(row.amount_atomic));
  const notBefore = dryRun ? undefined : Math.floor(new Date(row.requested_at).getTime() / 1000) - 5;
  let check;
  try { check = await verifyUsdcTransfer({ signature, recipient: String(row.recipient), amountAtomic, notBefore }); }
  catch (e) { return Response.json({ ok: false, retry: true, error: (e as Error).message }, { status: 502 }); }
  if (!check.ok) return Response.json({ ok: false, retry: /not found|not confirmed/i.test(check.reason ?? ""), error: check.reason, check }, { status: 422 });

  const onchain: OnchainPayment = {
    chain: "solana-mainnet", asset: "USDC", mint: USDC_MINT_SOLANA,
    amount: String(row.amount), amountAtomic: String(row.amount_atomic), recipient: String(row.recipient), sender: check.sender,
    signature, explorerUrl: `https://solscan.io/tx/${signature}`, kiteRequestId: String(b?.kiteRequestId ?? row.kite_request_id ?? "") || undefined,
    slot: check.slot, blockTime: check.blockTime, verifiedAt: new Date().toISOString(),
  };
  const settle = sql`WITH p AS (
      UPDATE bb_real_settlements SET status='settled', signature=${signature}, onchain=${JSON.stringify(onchain)}::jsonb,
        kite_request_id=COALESCE(${onchain.kiteRequestId ?? null}, kite_request_id), approval_url=NULL, error=NULL, settled_at=now(), updated_at=now()
      WHERE id=${id}::uuid AND status IN ('requested','awaiting_approval') RETURNING negotiation_id
    ), n AS (
      SELECT n.buyer_id, n.quantity, l.asset_id FROM bb_negotiations n JOIN bb_listings l ON l.id=n.listing_id WHERE n.id IN (SELECT negotiation_id FROM p)
    ), whole AS (
      UPDATE bb_assets a SET owner_id=n.buyer_id, reserved_quantity=0, source='manual', verified_ownership=false,
        metadata=COALESCE(a.metadata,'{}'::jsonb)||jsonb_build_object('acquired_via','blackbox-deal','negotiation_id',${String(row.negotiation_id)}::text,'payment_signature',${signature}::text,'payment_chain','solana-mainnet')
      FROM n WHERE a.id=n.asset_id AND a.quantity<=n.quantity RETURNING a.id
    ), part AS (
      UPDATE bb_assets a SET quantity=a.quantity-n.quantity, reserved_quantity=GREATEST(0,a.reserved_quantity-n.quantity)
      FROM n WHERE a.id=n.asset_id AND a.quantity>n.quantity RETURNING a.asset_type,a.symbol,a.name,a.unit,a.metadata,a.chain,a.contract_address
    ), b AS (
      INSERT INTO bb_assets(owner_id,asset_type,symbol,name,quantity,unit,metadata,source,verified_ownership,chain,contract_address)
      SELECT n.buyer_id,s.asset_type,s.symbol,s.name,n.quantity,s.unit,
        COALESCE(s.metadata,'{}'::jsonb)||jsonb_build_object('acquired_via','blackbox-deal','negotiation_id',${String(row.negotiation_id)}::text,'payment_signature',${signature}::text,'payment_chain','solana-mainnet'),
        'manual',false,s.chain,s.contract_address
      FROM n CROSS JOIN part s RETURNING id
    ) SELECT (SELECT count(*) FROM p) AS settled, COALESCE((SELECT id FROM b LIMIT 1),(SELECT id FROM whole LIMIT 1)) AS buyer_asset_id`;
  if (dryRun) {
    try { await sql.transaction([settle, sql`SELECT (1/0)`]); return Response.json({ ok: false, error: "dry run did not roll back" }, { status: 500 }); }
    catch (e) {
      const msg = (e as Error).message;
      return Response.json({ dryRun: true, ok: /division by zero/i.test(msg), dbError: /division by zero/i.test(msg) ? null : msg, check, wouldRecord: onchain, note: "Rolled back. Nothing was written." });
    }
  }
  const out = await sql.transaction([settle, sql`UPDATE bb_listings SET updated_at=now() WHERE id=${String(row.listing_id)}::uuid`]);
  const res = (out[0] as Record<string, any>[])[0] ?? {};
  if (res.buyer_asset_id) await sql`UPDATE bb_real_settlements SET buyer_asset_id=${String(res.buyer_asset_id)}::uuid WHERE id=${id}::uuid`;
  return Response.json({ ok: Number(res.settled) === 1, status: "settled", amount: atomicToUsdc(BigInt(String(row.amount_atomic))), buyerAssetId: res.buyer_asset_id ?? null, onchain });
}

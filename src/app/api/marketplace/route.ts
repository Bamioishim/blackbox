import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { ensureRealSchema, publicSettlement } from "@/lib/real-deal";

export async function GET(req:Request) {
  const user=await currentUser();
  const q=new URL(req.url).searchParams.get("q")?.trim().slice(0,80)??"";
  const sql=db();
  await ensureRealSchema();
  await sql`WITH expired AS (
    UPDATE bb_listings SET status='Expired',updated_at=now()
    WHERE status='Listed' AND expires_at IS NOT NULL AND expires_at<=now()
    RETURNING asset_id,quantity
  ), released AS (
    UPDATE bb_assets a SET reserved_quantity=GREATEST(0,a.reserved_quantity-x.qty)
    FROM (SELECT asset_id,SUM(quantity) AS qty FROM expired GROUP BY asset_id) x
    WHERE a.id=x.asset_id RETURNING a.id
  ) SELECT count(*) FROM released`;
  const listings=q
    ? await sql`SELECT l.id,l.quantity,l.currency,l.max_rounds,l.expires_at,l.status,l.created_at,a.asset_type,a.symbol,a.name,a.unit,a.chain,a.metadata,(w.solana_address IS NOT NULL) AS real_settlement FROM bb_listings l JOIN bb_assets a ON a.id=l.asset_id LEFT JOIN bb_payout_wallets w ON w.user_id=l.seller_id::text WHERE l.status='Listed' AND (a.name ILIKE ${"%"+q+"%"} OR a.symbol ILIKE ${"%"+q+"%"}) ORDER BY l.created_at DESC LIMIT 100`
    : await sql`SELECT l.id,l.quantity,l.currency,l.max_rounds,l.expires_at,l.status,l.created_at,a.asset_type,a.symbol,a.name,a.unit,a.chain,a.metadata,(w.solana_address IS NOT NULL) AS real_settlement FROM bb_listings l JOIN bb_assets a ON a.id=l.asset_id LEFT JOIN bb_payout_wallets w ON w.user_id=l.seller_id::text WHERE l.status='Listed' ORDER BY l.created_at DESC LIMIT 100`;
  let mine:unknown[]=[];
  let deals:unknown[]=[];
  if(user){
    mine=await sql`SELECT l.id,l.quantity,l.floor_price,l.currency,l.max_rounds,l.expires_at,l.status,l.created_at,l.asset_snapshot,
      (SELECT r.status FROM bb_real_settlements r WHERE r.listing_id=l.id ORDER BY r.created_at DESC LIMIT 1) AS settlement_status
      FROM bb_listings l WHERE l.seller_id=${user.id} ORDER BY l.created_at DESC LIMIT 100`;
    const rows=await sql`SELECT n.id,n.listing_id,n.buyer_id,n.seller_id,n.status,n.result,n.receipt_hash,n.receipt,n.error,n.created_at,n.completed_at,to_jsonb(r.*) AS real_row
      FROM bb_negotiations n LEFT JOIN bb_real_settlements r ON r.negotiation_id=n.id
      WHERE n.buyer_id=${user.id} OR n.seller_id=${user.id} ORDER BY n.created_at DESC LIMIT 100`;
    deals=rows.map((d:any)=>{const {real_row,...rest}=d;if(real_row?.status==="settled"&&real_row.onchain&&rest.receipt)rest.receipt={...rest.receipt,onchainPayment:real_row.onchain};return {...rest,role:String(d.buyer_id)===String(user.id)?"buyer":"seller",settlement:publicSettlement(real_row,user.id)};});
  }
  return Response.json({listings,mine,deals});
}
export async function POST(req:Request) {
  const user=await currentUser();
  if(!user) return Response.json({error:"Sign in first."},{status:401});
  const b=await req.json().catch(()=>null) as Record<string,unknown>|null;
  const assetId=String(b?.assetId??"");
  const quantity=Number(b?.quantity),floor=Number(b?.floorPrice),reference=Number(b?.referencePrice);
  const rounds=Math.max(1,Math.min(3,Math.floor(Number(b?.maxRounds)||3)));
  const expiry=b?.expiresAt?new Date(String(b.expiresAt)):null;
  if(!assetId||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(floor)||floor<=0||(b?.referencePrice!==undefined&&(!Number.isFinite(reference)||reference<=0))||(expiry&&(!Number.isFinite(expiry.getTime())||expiry<=new Date()))) return Response.json({error:"Check the asset, quantity, price and optional expiry."},{status:400});
  const sql=db();
  const rows=await sql`WITH reserved AS (
    UPDATE bb_assets SET reserved_quantity=reserved_quantity+${quantity}
    WHERE id=${assetId}::uuid AND owner_id=${user.id} AND quantity-reserved_quantity>=${quantity}
    RETURNING id,asset_type,symbol,name,unit,chain,metadata
  )
  INSERT INTO bb_listings(seller_id,asset_id,quantity,floor_price,currency,max_rounds,expires_at,reference_price,exclusive,partial_fills,asset_snapshot)
  SELECT ${user.id},id,${quantity},${floor},'USDC',${rounds},${expiry?.toISOString()??null},${b?.referencePrice===undefined?null:reference},true,false,
    jsonb_build_object('asset_type',asset_type,'symbol',symbol,'name',name,'unit',unit,'chain',chain,'metadata',metadata)
  FROM reserved RETURNING id,status,quantity,max_rounds,expires_at`;
  if(!rows.length) return Response.json({error:"That quantity is not available in your portfolio. Reduce it or add the asset first."},{status:409});
  return Response.json({listing:rows[0]},{status:201});
}

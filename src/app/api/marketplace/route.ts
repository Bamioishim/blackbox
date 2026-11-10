import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

export async function GET(req:Request) {
  const user=await currentUser();
  const q=new URL(req.url).searchParams.get("q")?.trim().slice(0,80)??"";
  const sql=db();
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
    ? await sql`SELECT l.id,l.quantity,l.currency,l.max_rounds,l.expires_at,l.status,l.created_at,a.asset_type,a.symbol,a.name,a.unit,a.chain,a.metadata FROM bb_listings l JOIN bb_assets a ON a.id=l.asset_id WHERE l.status='Listed' AND (a.name ILIKE ${"%"+q+"%"} OR a.symbol ILIKE ${"%"+q+"%"}) ORDER BY l.created_at DESC LIMIT 100`
    : await sql`SELECT l.id,l.quantity,l.currency,l.max_rounds,l.expires_at,l.status,l.created_at,a.asset_type,a.symbol,a.name,a.unit,a.chain,a.metadata FROM bb_listings l JOIN bb_assets a ON a.id=l.asset_id WHERE l.status='Listed' ORDER BY l.created_at DESC LIMIT 100`;
  let mine:unknown[]=[];
  let deals:unknown[]=[];
  if(user){
    mine=await sql`SELECT id,quantity,floor_price,currency,max_rounds,expires_at,status,created_at,asset_snapshot FROM bb_listings WHERE seller_id=${user.id} ORDER BY created_at DESC LIMIT 100`;
    deals=await sql`SELECT id,listing_id,buyer_id,seller_id,status,result,receipt_hash,receipt,error,created_at,completed_at FROM bb_negotiations WHERE buyer_id=${user.id} OR seller_id=${user.id} ORDER BY created_at DESC LIMIT 100`;
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

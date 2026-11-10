import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({error:"Sign in first."},{status:401});
  const sql = db();
  const assets = await sql`SELECT id,asset_type,symbol,name,quantity,reserved_quantity,unit,metadata,source,verified_ownership,chain,contract_address,cost_basis,created_at,(quantity-reserved_quantity) AS available_quantity FROM bb_assets WHERE owner_id=${user.id} ORDER BY created_at DESC`;
  return Response.json({assets});
}
export async function POST(req:Request) {
  const user = await currentUser();
  if (!user) return Response.json({error:"Sign in first."},{status:401});
  const b = await req.json().catch(()=>null) as Record<string,unknown>|null;
  const type = String(b?.assetType??"");
  const name = String(b?.name??"").trim().slice(0,100);
  const symbol = String(b?.symbol??"").trim().slice(0,24) || null;
  const quantity = Number(b?.quantity);
  const unit = String(b?.unit??"").trim().slice(0,30) || null;
  if (!["token","nft","collectible","other"].includes(type) || !name || !Number.isFinite(quantity) || quantity<=0 || quantity>1e12) return Response.json({error:"Enter a valid asset and positive quantity."},{status:400});
  const sql=db();
  const rows=await sql`INSERT INTO bb_assets(owner_id,asset_type,symbol,name,quantity,unit,metadata,source,verified_ownership) VALUES (${user.id},${type},${symbol},${name},${quantity},${unit},${JSON.stringify({})}::jsonb,'manual',false) RETURNING id,asset_type,symbol,name,quantity,reserved_quantity,unit,metadata,source,verified_ownership,created_at`;
  return Response.json({asset:rows[0]},{status:201});
}

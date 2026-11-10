import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
export async function DELETE(_req:Request,{params}:{params:Promise<{id:string}>}) {
 const user=await currentUser();if(!user)return Response.json({error:"Sign in first."},{status:401});
 const {id}=await params;const sql=db();
 const rows=await sql`WITH removed AS (
  UPDATE bb_listings SET status='Cancelled',cancelled_at=now(),updated_at=now()
  WHERE id=${id}::uuid AND seller_id=${user.id} AND status='Listed' RETURNING asset_id,quantity
 ), released AS (
  UPDATE bb_assets a SET reserved_quantity=GREATEST(0,a.reserved_quantity-r.quantity)
  FROM removed r WHERE a.id=r.asset_id RETURNING a.id
 ) SELECT id FROM released`;
 if(!rows.length)return Response.json({error:"Only an active listing you own can be withdrawn."},{status:409});
 return Response.json({ok:true});
}

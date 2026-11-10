import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
 const user=await currentUser();if(!user)return Response.json({error:"Sign in first."},{status:401});
 const {id}=await params;const sql=db();
 const rows=await sql`SELECT id,listing_id,buyer_id,seller_id,status,result,receipt_hash,receipt,error,created_at,completed_at FROM bb_negotiations WHERE id=${id}::uuid AND (buyer_id=${user.id} OR seller_id=${user.id}) LIMIT 1`;
 if(!rows.length)return Response.json({error:"Deal not found."},{status:404});
 return Response.json({deal:rows[0]});
}

import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { negotiate } from "@/lib/negotiate";
import { sendDealCompletedEmail } from "@/lib/email";

export const maxDuration=300;
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const buyer=await currentUser();
  if(!buyer) return Response.json({error:"Sign in first."},{status:401});
  const {id}=await params;
  const b=await req.json().catch(()=>null) as Record<string,unknown>|null;
  const ceiling=Number(b?.buyerCeiling), budget=Number(b?.budget), buyerRounds=Math.max(1,Math.min(3,Math.floor(Number(b?.maxRounds)||3)));
  if(!Number.isFinite(ceiling)||ceiling<=0||!Number.isFinite(budget)||budget<=0) return Response.json({error:"Enter a valid buyer ceiling and total spending limit."},{status:400});
  const sql=db();
  const locked=await sql`UPDATE bb_listings SET status='Negotiating',updated_at=now() WHERE id=${id}::uuid AND status='Listed' AND seller_id<>${buyer.id} AND (expires_at IS NULL OR expires_at>now()) RETURNING *`;
  if(!locked.length) return Response.json({error:"This listing is unavailable, expired, or belongs to you."},{status:409});
  const listing=locked[0] as Record<string,any>;
  try {
    const prior=await sql`SELECT buyer_ceiling,buyer_max_rounds,result FROM bb_negotiations WHERE listing_id=${id}::uuid AND buyer_id=${buyer.id} ORDER BY created_at DESC LIMIT 1`;
    const old=prior[0] as Record<string,any>|undefined;
    const effectiveCeiling=old?Number(old.buyer_ceiling):ceiling;
    const effectiveRounds=old?Number(old.buyer_max_rounds):buyerRounds;
    const seller=await sql`SELECT id,email,display_name FROM bb_users WHERE id=${listing.seller_id} LIMIT 1`;
    const sellerUser=seller[0] as {id:string;email:string;display_name:string|null};
    const asset=listing.asset_snapshot as Record<string,any>;
    const qty=Number(listing.quantity);
    const eff=Math.min(effectiveRounds,Number(listing.max_rounds),3);
    const inserted=await sql`INSERT INTO bb_negotiations(listing_id,buyer_id,seller_id,asset_snapshot,quantity,buyer_ceiling,buyer_max_rounds,seller_floor,seller_max_rounds,effective_rounds,status)
      VALUES(${id}::uuid,${buyer.id},${sellerUser.id},${JSON.stringify(asset)}::jsonb,${qty},${effectiveCeiling},${effectiveRounds},${Number(listing.floor_price)},${Number(listing.max_rounds)},${eff},'Running') RETURNING id`;
    const negotiationId=String((inserted[0] as {id:string}).id);
    const receipt=await negotiate({
      item:String(asset.name??asset.symbol??"Asset"),
      quantity:qty,
      referencePrice:Number(listing.reference_price??listing.floor_price),
      buyerCeiling:effectiveCeiling,
      sellerFloor:Number(listing.floor_price),
      buyerStyle:"balanced",
      sellerStyle:"balanced",
      buyerMaxRounds:effectiveRounds,
      sellerMaxRounds:Number(listing.max_rounds),
      attackMode:false,
      budget:old?Number(old.buyer_budget??budget):budget
    },()=>{});
    const outcome=receipt.outcome.status==="closed"?"Deal reached":"No deal";
    await sql`UPDATE bb_negotiations SET status=${outcome},result=${JSON.stringify(receipt.outcome)}::jsonb,receipt=${JSON.stringify(receipt)}::jsonb,receipt_hash=${receipt.finalHash},completed_at=now() WHERE id=${negotiationId}::uuid`;
    await sql`UPDATE bb_listings SET status=${outcome==="Deal reached"?"Deal reached":"Listed"},updated_at=now() WHERE id=${id}::uuid`;
    let emailed=false;
    if(outcome==="Deal reached" && receipt.outcome.unitPrice!==null && receipt.outcome.total!==null) {
      const sent=await Promise.allSettled([
        sendDealCompletedEmail({to:buyer.email,name:buyer.display_name??buyer.email,dealId:receipt.dealId,asset:String(asset.name??asset.symbol??"Asset"),quantity:qty,price:receipt.outcome.unitPrice,total:receipt.outcome.total,receiptHash:receipt.finalHash,status:"Deal reached · settlement simulated"}),
        sendDealCompletedEmail({to:sellerUser.email,name:sellerUser.display_name??sellerUser.email,dealId:receipt.dealId,asset:String(asset.name??asset.symbol??"Asset"),quantity:qty,price:receipt.outcome.unitPrice,total:receipt.outcome.total,receiptHash:receipt.finalHash,status:"Deal reached · settlement simulated"})
      ]);
      emailed=sent.some(x=>x.status==="fulfilled"&&x.value);
      if(emailed) await sql`UPDATE bb_negotiations SET email_sent_at=now() WHERE id=${negotiationId}::uuid`;
    }
    return Response.json({negotiationId,outcome,receipt,emailed});
  } catch(e) {
    await sql`UPDATE bb_listings SET status='Listed',updated_at=now() WHERE id=${id}::uuid AND status='Negotiating'`;
    return Response.json({error:(e as Error).message||"Negotiation failed; listing was reopened."},{status:500});
  }
}

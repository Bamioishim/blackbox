import { after } from "next/server";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { negotiate } from "@/lib/negotiate";
import { sendDealCompletedEmail } from "@/lib/email";
import { KitePendingSettler } from "@/lib/settle";
import { ensureRealSchema, markNegotiationOutcome, payoutAddressFor, realSettleAllowed, realSettleMax, settlementForNegotiation } from "@/lib/real-deal";

export const maxDuration=300;

async function processNegotiation(negotiationId:string) {
  const sql=db();
  try {
    const rows=await sql`SELECT n.*,l.floor_price,l.max_rounds AS listing_rounds,l.reference_price,l.currency FROM bb_negotiations n JOIN bb_listings l ON l.id=n.listing_id WHERE n.id=${negotiationId}::uuid LIMIT 1`;
    if(!rows.length) throw new Error("Negotiation record not found.");
    const n=rows[0] as Record<string,any>;
    const people=await sql`SELECT id,email,display_name FROM bb_users WHERE id IN (${n.buyer_id},${n.seller_id})`;
    const buyer=people.find((p:any)=>p.id===n.buyer_id) as {id:string;email:string;display_name:string|null}|undefined;
    const seller=people.find((p:any)=>p.id===n.seller_id) as {id:string;email:string;display_name:string|null}|undefined;
    if(!buyer||!seller) throw new Error("Buyer or seller account no longer exists.");
    const asset=n.asset_snapshot as Record<string,any>;
    const quantity=Number(n.quantity);
    const real=await settlementForNegotiation(negotiationId);
    const receipt=await negotiate({
      ...(real?{settler:new KitePendingSettler({chain:"solana",address:String(real.recipient)})}:{}),
      item:String(asset.name??asset.symbol??"Asset"),
      quantity,
      referencePrice:Number(n.reference_price??n.floor_price),
      buyerCeiling:Number(n.buyer_ceiling),
      sellerFloor:Number(n.seller_floor),
      buyerStyle:"balanced",
      sellerStyle:"balanced",
      buyerMaxRounds:Number(n.buyer_max_rounds),
      sellerMaxRounds:Number(n.seller_max_rounds),
      attackMode:false,
      budget:Number(n.buyer_budget),
      buyerOwner:{provider:"blackbox-account",account:buyer.id,wallet:{evm:"",solana:""},backend:"Blackbox"},
      sellerOwner:{provider:"blackbox-account",account:seller.id,wallet:{evm:"",solana:real?String(real.recipient):""},backend:"Blackbox"}
    },()=>{});
    const outcome=receipt.outcome.status==="closed"?"Deal reached":"No deal";
    await sql`UPDATE bb_negotiations SET status=${outcome},result=${JSON.stringify(receipt.outcome)}::jsonb,receipt=${JSON.stringify(receipt)}::jsonb,receipt_hash=${receipt.finalHash},completed_at=now(),error=NULL WHERE id=${negotiationId}::uuid`;
    await sql`UPDATE bb_listings SET status=${outcome==="Deal reached"?"Deal reached":"Listed"},updated_at=now() WHERE id=${n.listing_id}::uuid AND status='Negotiating'`;
    if(real) await markNegotiationOutcome(negotiationId,outcome==="Deal reached"?receipt.outcome.total:null);
    if(outcome==="Deal reached"&&receipt.outcome.unitPrice!==null&&receipt.outcome.total!==null){
      const messages=await Promise.allSettled([
        sendDealCompletedEmail({to:buyer.email,name:buyer.display_name??buyer.email,dealId:receipt.dealId,asset:String(asset.name??asset.symbol??"Asset"),quantity,price:receipt.outcome.unitPrice,total:receipt.outcome.total,receiptHash:receipt.finalHash,status:real?"Deal reached · real USDC payment requested":"Deal reached · settlement simulated"}),
        sendDealCompletedEmail({to:seller.email,name:seller.display_name??seller.email,dealId:receipt.dealId,asset:String(asset.name??asset.symbol??"Asset"),quantity,price:receipt.outcome.unitPrice,total:receipt.outcome.total,receiptHash:receipt.finalHash,status:real?"Deal reached · real USDC payment requested":"Deal reached · settlement simulated"})
      ]);
      if(messages.some(x=>x.status==="fulfilled"&&x.value)) await sql`UPDATE bb_negotiations SET email_sent_at=now() WHERE id=${negotiationId}::uuid`;
    }
  } catch(e) {
    await markNegotiationOutcome(negotiationId,null).catch(()=>{});
    await sql`UPDATE bb_negotiations SET status='Failed',error=${(e as Error).message||"Negotiation failed"},completed_at=now() WHERE id=${negotiationId}::uuid`;
    await sql`UPDATE bb_listings SET status='Listed',updated_at=now() WHERE id=(SELECT listing_id FROM bb_negotiations WHERE id=${negotiationId}::uuid) AND status='Negotiating'`;
  }
}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const buyer=await currentUser();
  if(!buyer) return Response.json({error:"Sign in first."},{status:401});
  const {id}=await params;
  const b=await req.json().catch(()=>null) as Record<string,unknown>|null;
  const ceiling=Number(b?.buyerCeiling),budget=Number(b?.budget),buyerRounds=Math.max(1,Math.min(3,Math.floor(Number(b?.maxRounds)||3)));
  if(!Number.isFinite(ceiling)||ceiling<=0||!Number.isFinite(budget)||budget<=0) return Response.json({error:"Enter a valid buyer ceiling and total spending limit."},{status:400});
  const wantsReal=b?.realSettlement===true;
  const sql=db();
  let payout:string|null=null;
  if(wantsReal){
    if(!realSettleAllowed(buyer.email)) return Response.json({error:"Real USDC settlement is limited to approved demo accounts. Untick it to run a simulated settlement."},{status:403});
    const cap=realSettleMax();
    if(budget>cap+1e-9) return Response.json({error:`Real settlement is capped at ${cap} USDC. Set a spending limit of ${cap} USDC or less.`},{status:400});
    const seller=await sql`SELECT seller_id FROM bb_listings WHERE id=${id}::uuid LIMIT 1`;
    if(!seller.length) return Response.json({error:"This listing is unavailable, expired, or belongs to you."},{status:409});
    payout=await payoutAddressFor(String((seller[0] as {seller_id:string}).seller_id));
    if(!payout) return Response.json({error:"The seller hasn't added a Solana payout address, so this listing can only settle in simulation."},{status:409});
    await ensureRealSchema();
  }
  const locked=await sql`UPDATE bb_listings SET status='Negotiating',updated_at=now() WHERE id=${id}::uuid AND status='Listed' AND seller_id<>${buyer.id} AND (expires_at IS NULL OR expires_at>now()) RETURNING *`;
  if(!locked.length) return Response.json({error:"This listing is unavailable, expired, or belongs to you."},{status:409});
  const listing=locked[0] as Record<string,any>;
  try {
    const prior=await sql`SELECT buyer_ceiling,buyer_max_rounds,buyer_budget FROM bb_negotiations WHERE listing_id=${id}::uuid AND buyer_id=${buyer.id} ORDER BY created_at DESC LIMIT 1`;
    const old=prior[0] as Record<string,any>|undefined;
    const effectiveCeiling=old?Number(old.buyer_ceiling):ceiling;
    const effectiveRounds=old?Number(old.buyer_max_rounds):buyerRounds;
    const effectiveBudget=old?Number(old.buyer_budget??budget):budget;
    const effective=Math.min(effectiveRounds,Number(listing.max_rounds),3);
    const asset=listing.asset_snapshot as Record<string,any>;
    const inserted=await sql`INSERT INTO bb_negotiations(listing_id,buyer_id,seller_id,asset_snapshot,quantity,buyer_ceiling,buyer_max_rounds,buyer_budget,seller_floor,seller_max_rounds,effective_rounds,status)
      VALUES(${id}::uuid,${buyer.id},${listing.seller_id},${JSON.stringify(asset)}::jsonb,${Number(listing.quantity)},${effectiveCeiling},${effectiveRounds},${effectiveBudget},${Number(listing.floor_price)},${Number(listing.max_rounds)},${effective},'Queued') RETURNING id`;
    const negotiationId=String((inserted[0] as {id:string}).id);
    if(wantsReal&&payout) await sql`INSERT INTO bb_real_settlements(negotiation_id,listing_id,buyer_id,seller_id,recipient,status) VALUES(${negotiationId}::uuid,${id}::uuid,${String(buyer.id)},${String(listing.seller_id)},${payout},'pending_deal')`;
    after(async()=>{await processNegotiation(negotiationId);});
    return Response.json({negotiationId,status:"Queued",effectiveRounds:effective,realSettlement:!!(wantsReal&&payout)},{status:202});
  } catch(e) {
    await sql`UPDATE bb_listings SET status='Listed',updated_at=now() WHERE id=${id}::uuid AND status='Negotiating'`;
    return Response.json({error:(e as Error).message||"Could not queue negotiation."},{status:500});
  }
}

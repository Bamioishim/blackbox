import "server-only";

export async function sendDealCompletedEmail(input:{to:string;name:string;dealId:string;asset:string;quantity:number;price:number;total:number;receiptHash:string;status:string}) {
  const key=process.env.RESEND_API_KEY;
  const from=process.env.RESEND_FROM_EMAIL;
  if(!key || !from) return false;
  const subject=`Blackbox deal ${input.dealId}: ${input.status}`;
  const text=[
    `Your Blackbox negotiation is complete.`,
    `Asset: ${input.asset}`,
    `Quantity: ${input.quantity}`,
    `Agreed unit price: ${input.price}`,
    `Agreed total: ${input.total}`,
    `Status: ${input.status}`,
    `Receipt hash: ${input.receiptHash}`,
    `Receipt: ${process.env.NEXT_PUBLIC_APP_URL??"https://blackbox-git-preview-bamioishim.vercel.app"}/verify?id=${input.dealId}`,
    `Settlement is simulated in this preview. No assets or funds were transferred.`
  ].join("\n");
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:input.to,subject,text})});
  return response.ok;
}

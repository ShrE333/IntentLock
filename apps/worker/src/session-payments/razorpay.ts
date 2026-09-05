export type SessionRazorpayEnv={
  RAZORPAY_KEY_ID?:string;
  RAZORPAY_KEY_SECRET?:string;
};

export type RazorpaySessionLink={
  id:string;
  short_url:string;
  status:string;
  reference_id:string;
  amount:number;
  currency:string;
  expire_by?:number|null;
};

function rupeesToPaise(amount:number){
  if(!Number.isFinite(amount)||amount<=0) throw new Error("INVALID_AMOUNT");
  return Math.round(amount*100);
}

export function buildSessionReferenceId(idempotencyKey:string){
  const suffix=idempotencyKey.split(":").pop()??idempotencyKey;
  return `ilps_${suffix.slice(0,24)}`;
}

export async function createSessionRazorpayLink(
  env:SessionRazorpayEnv,
  input:{
    sessionId:string;
    walletId:string;
    authorizationId:string|null;
    quoteHash:string;
    productId:string;
    productTitle:string;
    amount:number;
    currency:"INR";
    idempotencyKey:string;
    expireBy:number;
  }
):Promise<RazorpaySessionLink>{
  if(!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET)
    throw new Error("RAZORPAY_NOT_CONFIGURED");

  const auth=btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const response=await fetch("https://api.razorpay.com/v1/payment_links",{
    method:"POST",
    headers:{
      authorization:`Basic ${auth}`,
      "content-type":"application/json"
    },
    body:JSON.stringify({
      amount:rupeesToPaise(input.amount),
      currency:input.currency,
      accept_partial:false,
      expire_by:input.expireBy,
      reference_id:buildSessionReferenceId(input.idempotencyKey),
      description:`IntentLock PurchaseSession: ${input.productTitle}`,
      notes:{
        intentlock:"true",
        intentlock_flow:"purchase_session",
        intentlock_session_id:input.sessionId,
        intentlock_wallet_id:input.walletId,
        intentlock_authorization_id:input.authorizationId??"wallet-policy",
        intentlock_quote_hash:input.quoteHash,
        intentlock_product_id:input.productId
      }
    })
  });

  const data:any=await response.json();

  if(!response.ok){
    throw new Error(
      `RAZORPAY_${response.status}: ${data?.error?.description??"Payment Link creation failed"}`
    );
  }

  return data as RazorpaySessionLink;
}

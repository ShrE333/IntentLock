import type {
  CreateCheckoutInput,
  PaymentAuthorization,
  PaymentCaptureRequest,
  PaymentCheckout
} from "./types";

import {assertTrustedRecipient,type RecipientEnv} from '../../payments/recipient-binding';
export type PayPalEnv = RecipientEnv & {
  PAYPAL_ENV?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_RETURN_BASE_URL?: string;
};

type FetchLike = typeof fetch;
import {validMoney} from '../../wallets/validation';

export const PAYPAL_CURRENCIES = new Set([
  "AUD","BRL","CAD","CNY","CZK","DKK","EUR","HKD","HUF","ILS","JPY",
  "MYR","MXN","TWD","NZD","NOK","PHP","PLN","GBP","RUB","SGD","SEK",
  "CHF","THB","USD"
]);

export function isPayPalSupportedCurrency(currency:string){
  return PAYPAL_CURRENCIES.has(currency.trim().toUpperCase());
}

export function paypalBaseUrl(env:PayPalEnv){
  return String(env.PAYPAL_ENV??"sandbox").toLowerCase()==="live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

const PAYPAL_ZERO_DECIMAL_CURRENCIES=new Set(["HUF","JPY","TWD"]);

export function formatPayPalMoney(amount:number,currency:string){
  if(!Number.isFinite(amount) || amount<=0) throw new Error("INVALID_AMOUNT");
  const c=currency.trim().toUpperCase();
  if(PAYPAL_ZERO_DECIMAL_CURRENCIES.has(c)){
    if(!Number.isInteger(amount)) throw new Error(`PAYPAL_ZERO_DECIMAL_CURRENCY_REQUIRES_INTEGER:${c}`);
    return amount.toFixed(0);
  }
  if(!validMoney(amount,c))throw new Error('INVALID_MONETARY_VALUE');
  return amount.toFixed(2);
}

function authHeader(clientId:string,clientSecret:string){
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function jsonOrText(response:Response){
  const raw=await response.text();
  try{return raw?JSON.parse(raw):{};}catch{return {raw};}
}

export async function getPayPalAccessToken(
  env:PayPalEnv,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)
    throw new Error("PAYPAL_NOT_CONFIGURED");

  const response=await fetcher(`${paypalBaseUrl(env)}/v1/oauth2/token`,{
    method:"POST",
    headers:{
      authorization:authHeader(env.PAYPAL_CLIENT_ID,env.PAYPAL_CLIENT_SECRET),
      "content-type":"application/x-www-form-urlencoded",
      accept:"application/json"
    },
    body:"grant_type=client_credentials"
  });

  const body:any=await jsonOrText(response);
  if(!response.ok || !body?.access_token){
    throw new Error(`PAYPAL_OAUTH_${response.status}:${body?.error_description??body?.error??"token failed"}`);
  }
  return String(body.access_token);
}

async function paypalRequest(
  env:PayPalEnv,
  path:string,
  init:RequestInit,
  requestId?:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis),
  accessToken?:string,
  onResponse?:(raw:unknown)=>Promise<void>
){
  const token=accessToken??await getPayPalAccessToken(env,fetcher);
  const headers:Record<string,string>={
    authorization:`Bearer ${token}`,
    "content-type":"application/json",
    accept:"application/json",
    ...(init.headers as Record<string,string>|undefined)
  };
  if(requestId) headers["PayPal-Request-Id"]=requestId.slice(0,108);

  const response=await fetcher(`${paypalBaseUrl(env)}${path}`,{...init,headers});
  const body:any=await jsonOrText(response);
  await onResponse?.(body);
  if(!response.ok){
    const detail=body?.details?.[0]?.issue??body?.message??body?.name??"request failed";
    throw new Error(`PAYPAL_${response.status}:${detail}`);
  }
  return body;
}

export async function getPayPalCaptureDetails(
  env:PayPalEnv,
  captureId:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!captureId) throw new Error("PAYPAL_CAPTURE_ID_REQUIRED");
  const body=await paypalRequest(
    env,
    `/v2/payments/captures/${encodeURIComponent(captureId)}`,
    {method:"GET"},
    undefined,
    fetcher
  );
  return {
    captureId:String(body?.id??captureId),
    status:String(body?.status??"UNKNOWN"),
    amount:Number(body?.amount?.value??0),
    currency:String(body?.amount?.currency_code??"").toUpperCase(),
    createTime:body?.create_time?String(body.create_time):null,
    updateTime:body?.update_time?String(body.update_time):null
  };
}

export async function createPayPalOrder(
  env:PayPalEnv,
  input:CreateCheckoutInput,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<PaymentCheckout>{
  const recipient=await assertTrustedRecipient(env,input.expectedRecipient);
  const currency=input.currency.toUpperCase();
  if(!isPayPalSupportedCurrency(currency))
    throw new Error(`PAYPAL_UNSUPPORTED_CURRENCY:${currency}`);

  const base=String(env.PAYPAL_RETURN_BASE_URL??"").replace(/\/+$/g,"");
  if(!base) throw new Error("PAYPAL_RETURN_BASE_URL_NOT_CONFIGURED");

  const returnUrl=`${base}/new-purchase?paypal=approved&sessionId=${encodeURIComponent(input.sessionId)}`;
  const cancelUrl=`${base}/new-purchase?paypal=cancelled&sessionId=${encodeURIComponent(input.sessionId)}`;

  const body=await paypalRequest(
    env,
    "/v2/checkout/orders",
    {
      method:"POST",
      headers:{Prefer:'return=representation'},
      body:JSON.stringify({
        intent:"AUTHORIZE",
        purchase_units:[{
          reference_id:input.sessionId,
          custom_id:input.sessionId,
          invoice_id:`intentlock-${input.sessionId}`.slice(0,127),
          payee:{merchant_id:recipient.paypalMerchantId},
          description:`IntentLock: ${input.productTitle}`.slice(0,127),
          amount:{currency_code:currency,value:formatPayPalMoney(input.amount,currency)}
        }],
        application_context:{return_url:returnUrl,cancel_url:cancelUrl,user_action:"CONTINUE"}
      })
    },
    `create-${input.idempotencyKey}`,
    fetcher,undefined,input.onProviderResponse
  );

  const approve=Array.isArray(body?.links)
    ? body.links.find((x:any)=>x?.rel==="approve" || x?.rel==="payer-action")
    : null;
  if(!body?.id || !approve?.href) throw new Error("PAYPAL_APPROVAL_URL_MISSING");
  return {
    providerResponse:body,provider:"paypal",providerOrderId:String(body.id),checkoutUrl:String(approve.href),
    status:String(body.status??"CREATED"),expiresAt:input.expiresAt,referenceId:input.sessionId
  };
}

export async function authorizePayPalOrder(
  env:PayPalEnv,orderId:string,idempotencyKey:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis),onResponse?:(raw:unknown)=>Promise<void>
):Promise<PaymentAuthorization>{
  const body=await paypalRequest(
    env,`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    {method:"POST",headers:{Prefer:'return=representation'},body:"{}"},`authorize-${idempotencyKey}`,fetcher,undefined,onResponse
  );
  const auth=body?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if(!auth?.id) throw new Error("PAYPAL_AUTHORIZATION_ID_MISSING");
  return {
    providerResponse:body,provider:"paypal",providerOrderId:orderId,providerAuthorizationId:String(auth.id),
    status:String(auth.status??body.status??"AUTHORIZED"),amount:Number(auth?.amount?.value??0),
    currency:String(auth?.amount?.currency_code??"").toUpperCase()
  };
}

export async function getPayPalReservationTruth(env:PayPalEnv,orderId:string,authorizationId?:string,fetcher:FetchLike=globalThis.fetch.bind(globalThis)){
 const order=await paypalRequest(env,`/v2/checkout/orders/${encodeURIComponent(orderId)}`,{method:'GET'},undefined,fetcher);
 if(order?.id!==orderId)throw new Error('PAYPAL_RECONCILIATION_IDENTITY_MISMATCH');
 if(!authorizationId){
  const auths=(order?.purchase_units??[]).flatMap((u:any)=>u?.payments?.authorizations??[]);
  if(auths.length!==1||!auths[0]?.id)return {order,authorization:null};
  authorizationId=String(auths[0].id);
 }
 const authorization=await paypalRequest(env,`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,{method:'GET'},undefined,fetcher);
 if(authorization?.id!==authorizationId)throw new Error('PAYPAL_RECONCILIATION_IDENTITY_MISMATCH');
 return {order,authorization};
}

export async function getPayPalRecipientFacts(env:PayPalEnv,orderId:string,authorizationId?:string|null,captureId?:string|null,fetcher:FetchLike=globalThis.fetch.bind(globalThis)){
 const token=await getPayPalAccessToken(env,fetcher);
 const read=(path:string)=>paypalRequest(env,path,{method:'GET'},undefined,fetcher,token);
 const order=await read(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
 const authorization=authorizationId?await read(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`):null;
 const capture=captureId?await read(`/v2/payments/captures/${encodeURIComponent(captureId)}`):null;
 return {order,authorization,capture};
}

export async function capturePayPalAuthorization(
  env:PayPalEnv,authorizationId:string,orderId:string,idempotencyKey:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis),onResponse?:(raw:unknown)=>Promise<void>,boundAmount?:{amount:number;currency:string}
):Promise<PaymentCaptureRequest>{
  if(!boundAmount)throw new Error('PAYPAL_BOUND_CAPTURE_AMOUNT_REQUIRED');
  const amount={currency_code:boundAmount.currency,value:formatPayPalMoney(boundAmount.amount,boundAmount.currency)};
  const body=await paypalRequest(
    env,`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    {method:"POST",headers:{Prefer:'return=representation'},body:JSON.stringify({amount,final_capture:true})},`capture-${idempotencyKey}`,fetcher,undefined,onResponse
  );
  return {
    providerResponse:body,provider:"paypal",providerOrderId:orderId,providerAuthorizationId:authorizationId,
    providerCaptureId:body?.id?String(body.id):null,status:String(body?.status??"PENDING"),
    amount:Number(body?.amount?.value??0),currency:String(body?.amount?.currency_code??"").toUpperCase()
  };
}

export type VerifiedPayPalWebhook = {valid:boolean;verificationStatus:string;event:any;};

export async function verifyPayPalWebhook(
  env:PayPalEnv,request:Request,rawBody:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<VerifiedPayPalWebhook>{
  if(!env.PAYPAL_WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID_NOT_CONFIGURED");
  const event=JSON.parse(rawBody);
  const transmissionId=request.headers.get("paypal-transmission-id");
  const transmissionTime=request.headers.get("paypal-transmission-time");
  const certUrl=request.headers.get("paypal-cert-url");
  const authAlgo=request.headers.get("paypal-auth-algo");
  const transmissionSig=request.headers.get("paypal-transmission-sig");
  if(!transmissionId||!transmissionTime||!certUrl||!authAlgo||!transmissionSig)
    return {valid:false,verificationStatus:"MISSING_HEADERS",event};

  const body=await paypalRequest(
    env,"/v1/notifications/verify-webhook-signature",
    {method:"POST",body:JSON.stringify({
      transmission_id:transmissionId,transmission_time:transmissionTime,
      cert_url:certUrl,auth_algo:authAlgo,transmission_sig:transmissionSig,
      webhook_id:env.PAYPAL_WEBHOOK_ID,webhook_event:event
    })},undefined,fetcher
  );
  const verificationStatus=String(body?.verification_status??"");
  return {valid:verificationStatus==="SUCCESS",verificationStatus,event};
}

export function extractPayPalWebhookIds(event:any){
  const resource=event?.resource??{};
  const related=resource?.supplementary_data?.related_ids??{};
  return {
    eventType:String(event?.event_type??"unknown"),eventId:event?.id?String(event.id):null,
    orderId:related?.order_id?String(related.order_id):null,
    authorizationId:related?.authorization_id?String(related.authorization_id):null,
    captureId:resource?.id?String(resource.id):null,
    amount:Number(resource?.amount?.value??0),currency:String(resource?.amount?.currency_code??"").toUpperCase()
  };
}

export async function createPayPalRefund(
  env:PayPalEnv,
  captureId:string,
  amount:number,
  currency:string,
  requestId:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!captureId) throw new Error("PAYPAL_CAPTURE_ID_REQUIRED");
  const body=await paypalRequest(
    env,
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    {
      method:"POST",
      body:JSON.stringify({
        amount:{currency_code:currency.toUpperCase(),value:formatPayPalMoney(amount,currency)}
      })
    },
    requestId,
    fetcher
  );
  if(!body?.id) throw new Error("PAYPAL_REFUND_ID_MISSING");
  return {
    refundId:String(body.id),status:String(body.status??"PENDING"),
    amount:Number(body?.amount?.value??amount),currency:String(body?.amount?.currency_code??currency).toUpperCase(),
    createTime:body?.create_time?String(body.create_time):null,
    updateTime:body?.update_time?String(body.update_time):null
  };
}

export async function getPayPalRefundDetails(
  env:PayPalEnv,
  refundId:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!refundId) throw new Error("PAYPAL_REFUND_ID_REQUIRED");
  const body=await paypalRequest(
    env,`/v2/payments/refunds/${encodeURIComponent(refundId)}`,
    {method:"GET"},undefined,fetcher
  );
  return {
    refundId:String(body?.id??refundId),status:String(body?.status??"UNKNOWN"),
    amount:Number(body?.amount?.value??0),currency:String(body?.amount?.currency_code??"").toUpperCase(),
    createTime:body?.create_time?String(body.create_time):null,
    updateTime:body?.update_time?String(body.update_time):null
  };
}

export async function listPayPalDisputes(
  env:PayPalEnv,
  disputedTransactionId?:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  const params=new URLSearchParams();
  params.set("page_size","20");
  if(disputedTransactionId) params.set("disputed_transaction_id",disputedTransactionId);
  const body=await paypalRequest(
    env,`/v1/customer/disputes?${params.toString()}`,
    {method:"GET"},undefined,fetcher
  );
  return Array.isArray(body?.items)?body.items:[];
}

export async function getPayPalDisputeDetails(
  env:PayPalEnv,
  disputeId:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!disputeId) throw new Error("PAYPAL_DISPUTE_ID_REQUIRED");
  return paypalRequest(
    env,`/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
    {method:"GET"},undefined,fetcher
  );
}

export async function sendPayPalDisputeMessage(
  env:PayPalEnv,
  disputeId:string,
  message:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  if(!disputeId) throw new Error("PAYPAL_DISPUTE_ID_REQUIRED");
  if(!message.trim()) throw new Error("PAYPAL_DISPUTE_MESSAGE_REQUIRED");
  return paypalRequest(
    env,`/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`,
    {method:"POST",body:JSON.stringify({message:message.slice(0,2000)})},
    `dispute-message-${disputeId}-${await shaRequestId(message)}`,
    fetcher
  );
}

async function shaRequestId(value:string){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].slice(0,12).map(x=>x.toString(16).padStart(2,"0")).join("");
}

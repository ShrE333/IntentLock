import type {
  CreateCheckoutInput,
  PaymentAuthorization,
  PaymentCaptureRequest,
  PaymentCheckout
} from "./types";

export type PayPalEnv = {
  PAYPAL_ENV?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_RETURN_BASE_URL?: string;
};

type FetchLike = typeof fetch;

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
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
){
  const token=await getPayPalAccessToken(env,fetcher);
  const headers:Record<string,string>={
    authorization:`Bearer ${token}`,
    "content-type":"application/json",
    accept:"application/json",
    ...(init.headers as Record<string,string>|undefined)
  };
  if(requestId) headers["PayPal-Request-Id"]=requestId.slice(0,108);

  const response=await fetcher(`${paypalBaseUrl(env)}${path}`,{...init,headers});
  const body:any=await jsonOrText(response);
  if(!response.ok){
    const detail=body?.details?.[0]?.issue??body?.message??body?.name??"request failed";
    throw new Error(`PAYPAL_${response.status}:${detail}`);
  }
  return body;
}

export async function createPayPalOrder(
  env:PayPalEnv,
  input:CreateCheckoutInput,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<PaymentCheckout>{
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
      body:JSON.stringify({
        intent:"AUTHORIZE",
        purchase_units:[{
          reference_id:input.sessionId,
          custom_id:input.sessionId,
          invoice_id:`intentlock-${input.sessionId}`.slice(0,127),
          description:`IntentLock: ${input.productTitle}`.slice(0,127),
          amount:{
            currency_code:currency,
            value:formatPayPalMoney(input.amount,currency)
          }
        }],
        application_context:{
          return_url:returnUrl,
          cancel_url:cancelUrl,
          user_action:"CONTINUE"
        }
      })
    },
    `create-${input.idempotencyKey}`,
    fetcher
  );

  const approve=Array.isArray(body?.links)
    ? body.links.find((x:any)=>x?.rel==="approve" || x?.rel==="payer-action")
    : null;

  if(!body?.id || !approve?.href)
    throw new Error("PAYPAL_APPROVAL_URL_MISSING");

  return {
    provider:"paypal",
    providerOrderId:String(body.id),
    checkoutUrl:String(approve.href),
    status:String(body.status??"CREATED"),
    expiresAt:input.expiresAt,
    referenceId:input.sessionId
  };
}

export async function authorizePayPalOrder(
  env:PayPalEnv,
  orderId:string,
  idempotencyKey:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<PaymentAuthorization>{
  const body=await paypalRequest(
    env,
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    {method:"POST",body:"{}"},
    `authorize-${idempotencyKey}`,
    fetcher
  );

  const auth=body?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if(!auth?.id) throw new Error("PAYPAL_AUTHORIZATION_ID_MISSING");

  return {
    provider:"paypal",
    providerOrderId:orderId,
    providerAuthorizationId:String(auth.id),
    status:String(auth.status??body.status??"AUTHORIZED"),
    amount:Number(auth?.amount?.value??0),
    currency:String(auth?.amount?.currency_code??"").toUpperCase()
  };
}

export async function capturePayPalAuthorization(
  env:PayPalEnv,
  authorizationId:string,
  orderId:string,
  idempotencyKey:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<PaymentCaptureRequest>{
  const body=await paypalRequest(
    env,
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    {method:"POST",body:"{}"},
    `capture-${idempotencyKey}`,
    fetcher
  );

  return {
    provider:"paypal",
    providerOrderId:orderId,
    providerAuthorizationId:authorizationId,
    providerCaptureId:body?.id?String(body.id):null,
    status:String(body?.status??"PENDING"),
    amount:Number(body?.amount?.value??0),
    currency:String(body?.amount?.currency_code??"").toUpperCase()
  };
}

export type VerifiedPayPalWebhook = {
  valid:boolean;
  verificationStatus:string;
  event:any;
};

export async function verifyPayPalWebhook(
  env:PayPalEnv,
  request:Request,
  rawBody:string,
  fetcher:FetchLike=globalThis.fetch.bind(globalThis)
):Promise<VerifiedPayPalWebhook>{
  if(!env.PAYPAL_WEBHOOK_ID) throw new Error("PAYPAL_WEBHOOK_ID_NOT_CONFIGURED");

  const event=JSON.parse(rawBody);
  const transmissionId=request.headers.get("paypal-transmission-id");
  const transmissionTime=request.headers.get("paypal-transmission-time");
  const certUrl=request.headers.get("paypal-cert-url");
  const authAlgo=request.headers.get("paypal-auth-algo");
  const transmissionSig=request.headers.get("paypal-transmission-sig");

  if(!transmissionId||!transmissionTime||!certUrl||!authAlgo||!transmissionSig){
    return {valid:false,verificationStatus:"MISSING_HEADERS",event};
  }

  const body=await paypalRequest(
    env,
    "/v1/notifications/verify-webhook-signature",
    {
      method:"POST",
      body:JSON.stringify({
        transmission_id:transmissionId,
        transmission_time:transmissionTime,
        cert_url:certUrl,
        auth_algo:authAlgo,
        transmission_sig:transmissionSig,
        webhook_id:env.PAYPAL_WEBHOOK_ID,
        webhook_event:event
      })
    },
    undefined,
    fetcher
  );

  const verificationStatus=String(body?.verification_status??"");
  return {
    valid:verificationStatus==="SUCCESS",
    verificationStatus,
    event
  };
}

export function extractPayPalWebhookIds(event:any){
  const resource=event?.resource??{};
  const related=resource?.supplementary_data?.related_ids??{};
  return {
    eventType:String(event?.event_type??"unknown"),
    eventId:event?.id?String(event.id):null,
    orderId:related?.order_id?String(related.order_id):null,
    authorizationId:related?.authorization_id?String(related.authorization_id):null,
    captureId:resource?.id?String(resource.id):null,
    amount:Number(resource?.amount?.value??0),
    currency:String(resource?.amount?.currency_code??"").toUpperCase()
  };
}

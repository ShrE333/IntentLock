import type {FxQuote} from "./context-types";

export type FxEnv={
  FX_PROVIDER?:string;
  FX_RATES_JSON?:string;
  FX_QUOTE_TTL_SECONDS?:string;
  FX_MAX_DRIFT_BPS?:string;
  FX_REVALIDATE?:string;
};

// Deterministic demo rates: currency units per 1 USD. They are intentionally
// labelled DEMO_STATIC in receipts and can be replaced with FX_RATES_JSON or a
// live Frankfurter quote source without changing policy logic.
const DEMO_USD_RATES:Record<string,number>={
  USD:1,EUR:0.92,GBP:0.78,INR:83.50,AUD:1.52,CAD:1.38,CHF:0.90,
  SGD:1.35,JPY:150.0,HKD:7.82,NZD:1.67,NOK:10.6,SEK:10.3,DKK:6.86,
  PLN:4.00,CZK:23.0,MXN:18.0,BRL:5.20,ILS:3.70,HUF:360,MYR:4.70,
  TWD:32.0,THB:36.0,PHP:58.0,CNY:7.20
};

const ZERO_DECIMAL=new Set(["JPY","HUF","TWD"]);
const norm=(v:string)=>v.trim().toUpperCase();

function roundCurrency(amount:number,currency:string){
  const digits=ZERO_DECIMAL.has(norm(currency))?0:2;
  const factor=10**digits;
  return Math.round((amount+Number.EPSILON)*factor)/factor;
}

function rates(env:FxEnv){
  if(!env.FX_RATES_JSON) return DEMO_USD_RATES;
  let parsed:any;
  try{parsed=JSON.parse(env.FX_RATES_JSON);}catch{throw new Error("FX_RATES_JSON_INVALID_JSON");}
  if(!parsed || typeof parsed!=="object") throw new Error("FX_RATES_JSON_INVALID");
  const out:Record<string,number>={...DEMO_USD_RATES};
  for(const [k,v] of Object.entries(parsed)){
    const n=Number(v);
    if(/^[A-Z]{3}$/.test(norm(k)) && Number.isFinite(n) && n>0) out[norm(k)]=n;
  }
  return out;
}

function ttlMs(env:FxEnv){
  const seconds=Number(env.FX_QUOTE_TTL_SECONDS??1800);
  return Math.max(300,Math.min(Number.isFinite(seconds)?seconds:1800,86400))*1000;
}

async function liveRate(from:string,to:string,fetcher:typeof fetch){
  const response=await fetcher(`https://api.frankfurter.app/latest?amount=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const body:any=await response.json().catch(()=>null);
  const rate=Number(body?.rates?.[to]);
  if(!response.ok || !Number.isFinite(rate) || rate<=0)
    throw new Error(`FX_LIVE_QUOTE_FAILED:${response.status}`);
  return rate;
}

async function getRate(env:FxEnv,from:string,to:string,fetcher:typeof fetch){
  if(from===to) return {rate:1,source:"SAME_CURRENCY"};
  const provider=String(env.FX_PROVIDER??"static").trim().toLowerCase();
  if(provider==="disabled" || provider==="none") throw new Error(`FX_REQUIRED:${from}:${to}`);
  if(provider==="frankfurter") return {rate:await liveRate(from,to,fetcher),source:"FRANKFURTER"};

  const r=rates(env);
  const fromPerUsd=r[from];
  const toPerUsd=r[to];
  if(!fromPerUsd || !toPerUsd) throw new Error(`FX_RATE_NOT_CONFIGURED:${from}:${to}`);
  return {rate:toPerUsd/fromPerUsd,source:env.FX_RATES_JSON?"STATIC_CONFIGURED":"DEMO_STATIC"};
}

export async function createFxQuote(
  env:FxEnv,
  fromCurrency:string,
  toCurrency:string,
  fromAmount:number,
  fetcher:typeof fetch=globalThis.fetch.bind(globalThis)
):Promise<FxQuote|null>{
  const from=norm(fromCurrency),to=norm(toCurrency);
  if(from===to) return null;
  if(!Number.isFinite(fromAmount)||fromAmount<=0) throw new Error("FX_INVALID_AMOUNT");

  const {rate,source}=await getRate(env,from,to,fetcher);
  const quotedAt=new Date();
  const toAmount=roundCurrency(fromAmount*rate,to);
  return {
    quoteId:`fx_${crypto.randomUUID()}`,
    fromCurrency:from,toCurrency:to,rate,
    fromAmount:roundCurrency(fromAmount,from),toAmount,source,
    quotedAt:quotedAt.toISOString(),
    expiresAt:new Date(quotedAt.getTime()+ttlMs(env)).toISOString()
  };
}

export function assertFxQuoteUsable(quote:FxQuote|null,now=Date.now()){
  if(!quote) return;
  if(new Date(quote.expiresAt).getTime()<=now) throw new Error("FX_QUOTE_EXPIRED_REAUTHORIZE");
  if(!Number.isFinite(quote.rate)||quote.rate<=0) throw new Error("FX_QUOTE_INVALID");
}

export async function revalidateFxDrift(
  env:FxEnv,
  quote:FxQuote|null,
  fetcher:typeof fetch=globalThis.fetch.bind(globalThis)
){
  if(!quote) return {checked:false,driftBps:0,currentRate:1};
  assertFxQuoteUsable(quote);
  const enabled=String(env.FX_REVALIDATE??"false").toLowerCase()==="true";
  if(!enabled) return {checked:false,driftBps:0,currentRate:quote.rate};

  const {rate}=await getRate(env,quote.fromCurrency,quote.toCurrency,fetcher);
  const driftBps=Math.abs((rate-quote.rate)/quote.rate)*10000;
  const max=Number(env.FX_MAX_DRIFT_BPS??100);
  if(driftBps>(Number.isFinite(max)?max:100))
    throw new Error(`FX_RATE_DRIFT_REAUTHORIZE:${driftBps.toFixed(2)}bps`);
  return {checked:true,driftBps,currentRate:rate};
}

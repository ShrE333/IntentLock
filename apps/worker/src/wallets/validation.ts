import {z} from 'zod';

// Accepted currency codes, including historical codes for existing wallets.
const currencies=new Set('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'.split(' '));
export const validCurrency=(v:unknown):v is string=>typeof v==='string'&&currencies.has(v);
export function validMoney(v:unknown,currency:unknown,allowZero=false):v is number{
  if(typeof v!=='number'||!Number.isFinite(v)||v>(Number.MAX_SAFE_INTEGER/1000)||(allowZero?v<0:v<=0)||!validCurrency(currency)) return false;
  const digits=['JPY','KRW','VND','CLP','XAF','XOF','XPF','BIF','DJF','GNF','KMF','PYG','RWF','UGX','VUV','ISK'].includes(currency)?0:['BHD','IQD','JOD','KWD','LYD','OMR','TND'].includes(currency)?3:2;
  // Validate the actual number's decimal representation. An epsilon comparison
  // can accidentally treat tiny positive/sub-minor-unit values as zero cents.
  return new RegExp(`^\\d+${digits?`(?:\\.\\d{1,${digits}})?`:''}$`).test(String(v));
}
export const CurrencySchema=z.string().refine(validCurrency,'INVALID_CURRENCY');
export const WalletTransactionSchema=z.object({
  productName:z.string().optional(),category:z.string().trim().min(1),brand:z.string().trim().min(1),
  amount:z.number().finite().positive(),currency:CurrencySchema,quantity:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),features:z.array(z.string()),
}).refine(tx=>validMoney(tx.amount,tx.currency),'INVALID_MONETARY_VALUE');
export const WalletCreateSchema=z.object({
  name:z.string().trim().min(1),currency:CurrencySchema.default('INR'),countryCode:z.string().regex(/^[A-Z]{2}$/).default('IN'),
  totalAuthority:z.number().finite().positive(),autoBuyLimit:z.number().finite().nonnegative(),maxSingleTransaction:z.number().finite().positive(),
  allowedCategories:z.array(z.string()).default([]),allowedBrands:z.array(z.string()).default([]),blockedBrands:z.array(z.string()).default([]),requiredFeatures:z.array(z.string()).default([]),
  validUntil:z.string().datetime(),
}).refine(w=>validMoney(w.totalAuthority,w.currency)&&validMoney(w.autoBuyLimit,w.currency,true)&&validMoney(w.maxSingleTransaction,w.currency),'INVALID_MONETARY_VALUE')
  .refine(w=>w.autoBuyLimit<=w.maxSingleTransaction&&w.maxSingleTransaction<=w.totalAuthority,'INVALID_AUTHORITY_HIERARCHY')
  .refine(w=>Date.parse(w.validUntil)>Date.now(),'INVALID_EXPIRY');

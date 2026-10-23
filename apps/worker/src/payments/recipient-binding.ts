import {sha256Hex} from '../wallets/crypto';
import type {CommerceProduct} from '../commerce/types';
export type RecipientEnv={PAYPAL_ENV?:string;PAYPAL_ACCOUNT_MERCHANT_ID?:string;PAYPAL_MERCHANT_BINDINGS_JSON?:string};
export type RecipientBinding={
 version:'intentlock-recipient-v1';provider:'paypal';environment:'sandbox'|'live';
 mappingId:string;mappingVersion:number;connectorId:string;catalogProvider:string;catalogSellerId:string;
 merchantOfRecordId:string;checkoutMerchantId:string;paypalMerchantId:string;
 integration:'DIRECT_MERCHANT';approvalReference:string;validUntil:string;fingerprint:string;
};
const merchantId=(s:unknown):s is string=>typeof s==='string'&&/^[2-9A-HJ-NP-Z]{13}$/.test(s);
const text=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=200&&s===s.trim();
export function recipientEnvironment(env:RecipientEnv):'sandbox'|'live'{
 const value=env.PAYPAL_ENV??'sandbox';if(value!=='sandbox'&&value!=='live')throw new Error('PAYPAL_ENVIRONMENT_INVALID');return value;
}
function registry(env:RecipientEnv):Omit<RecipientBinding,'version'|'provider'|'fingerprint'>[]{
 if(!env.PAYPAL_MERCHANT_BINDINGS_JSON)return [];
 let parsed:unknown;try{parsed=JSON.parse(env.PAYPAL_MERCHANT_BINDINGS_JSON);}catch{throw new Error('MERCHANT_REGISTRY_INVALID');}
 if(!Array.isArray(parsed))throw new Error('MERCHANT_REGISTRY_INVALID');
 const identities=new Set<string>();
 return parsed.map((r:any)=>{
  if(!r||!['sandbox','live'].includes(r.environment)||!['DIRECT_MERCHANT','PARTNER_ONBOARDED'].includes(r.integration)
   ||!['mappingId','connectorId','catalogProvider','catalogSellerId','merchantOfRecordId','checkoutMerchantId','approvalReference'].every(k=>text(r[k]))
   ||!merchantId(r.paypalMerchantId)||!Number.isSafeInteger(r.mappingVersion)||r.mappingVersion<1
   ||!Number.isFinite(Date.parse(r.validUntil)))throw new Error('MERCHANT_REGISTRY_INVALID');
  const key=JSON.stringify([r.environment,r.connectorId,r.catalogProvider,r.catalogSellerId]);
  if(identities.has(key))throw new Error('MERCHANT_REGISTRY_AMBIGUOUS');identities.add(key);
  return {mappingId:r.mappingId,mappingVersion:r.mappingVersion,environment:r.environment,connectorId:r.connectorId,
   catalogProvider:r.catalogProvider,catalogSellerId:r.catalogSellerId,merchantOfRecordId:r.merchantOfRecordId,
   checkoutMerchantId:r.checkoutMerchantId,paypalMerchantId:r.paypalMerchantId,integration:r.integration,
   approvalReference:r.approvalReference,validUntil:new Date(r.validUntil).toISOString()};
 });
}
export async function resolveRecipient(env:RecipientEnv,connectorId:string,product:CommerceProduct):Promise<RecipientBinding|null>{
 if(!['paypal-demo-marketplace','demo-marketplace'].includes(connectorId))return null;
 const entry=registry(env).find(r=>r.environment===recipientEnvironment(env)&&r.connectorId===connectorId
  &&r.catalogProvider===product.source?.provider&&r.catalogSellerId===product.source?.payeeId);
 if(!entry)return null;
 if(entry.integration!=='DIRECT_MERCHANT')throw new Error('PAYPAL_PARTNER_INTEGRATION_NOT_IMPLEMENTED');
 if(entry.paypalMerchantId!==env.PAYPAL_ACCOUNT_MERCHANT_ID)throw new Error('PAYPAL_CREDENTIAL_MERCHANT_MISMATCH');
 if(Date.parse(entry.validUntil)<=Date.now())throw new Error('MERCHANT_MAPPING_EXPIRED');
 const core={version:'intentlock-recipient-v1' as const,provider:'paypal' as const,...entry};
 return {...core,fingerprint:await sha256Hex(JSON.stringify(core))};
}
export async function assertTrustedRecipient(env:RecipientEnv,bound:RecipientBinding|undefined|null){
 if(!bound)throw new Error('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
 const current=await resolveRecipient(env,bound.connectorId,{source:{provider:bound.catalogProvider,payeeId:bound.catalogSellerId}} as CommerceProduct);
 if(!current||Object.keys(current).some(k=>(current as any)[k]!== (bound as any)[k]))throw new Error('RECIPIENT_MAPPING_CHANGED_REAUTHORIZE');return current;
}
export function assertExecutableCommerce(connectorId:string,environment:string){
 if(!['paypal-demo-marketplace','demo-marketplace'].includes(connectorId))throw new Error('COMMERCE_DISCOVERY_ONLY');
 if(environment!=='sandbox')throw new Error('DEMO_CHECKOUT_SANDBOX_ONLY');
}
export function recipientMappingConfigured(env:RecipientEnv){
 try{return registry(env).some(r=>r.environment===recipientEnvironment(env)&&r.integration==='DIRECT_MERCHANT'
  &&r.connectorId==='paypal-demo-marketplace'&&r.paypalMerchantId===env.PAYPAL_ACCOUNT_MERCHANT_ID&&Date.parse(r.validUntil)>Date.now());}catch{return false;}
}

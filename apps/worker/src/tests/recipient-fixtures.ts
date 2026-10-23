// Synthetic fixtures only. These IDs are not onboarded merchants or deployment config.
import {resolveRecipient} from '../payments/recipient-binding';
export const syntheticMerchant='TESTMERCHANT2';
export const otherSyntheticMerchant='BADPAYEE22222';
export const syntheticMapping={mappingId:'isolated-mapping',mappingVersion:1,environment:'sandbox',connectorId:'paypal-demo-marketplace',catalogProvider:'paypal-demo',catalogSellerId:'isolated-seller',merchantOfRecordId:'isolated-legal-entity',checkoutMerchantId:'isolated-checkout',paypalMerchantId:syntheticMerchant,integration:'DIRECT_MERCHANT',approvalReference:'ISOLATED-TEST-NOT-ONBOARDING',validUntil:'2099-01-01T00:00:00.000Z'};
export const syntheticEnv={PAYPAL_ENV:'sandbox',PAYPAL_ACCOUNT_MERCHANT_ID:syntheticMerchant,PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify([syntheticMapping])};
export const syntheticProduct={id:'product',title:'Synthetic headphones',brand:'Sony',category:'electronics',merchant:'Untrusted display name',currency:'USD',price:49,quantityAvailable:1,features:[],source:{provider:'paypal-demo',payeeId:'isolated-seller'}};
export async function syntheticBinding(){return (await resolveRecipient(syntheticEnv,'paypal-demo-marketplace',syntheticProduct))!;}

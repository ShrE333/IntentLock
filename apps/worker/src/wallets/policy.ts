import type {IntentWallet, WalletTransaction, WalletEvaluation} from "./types";
import {validCurrency,validMoney} from './validation';

const norm=(s:string)=>s.trim().toLowerCase();
const has=(xs:string[],x:string)=>xs.map(norm).includes(norm(x));
const amountLabel=(amount:number,currency:string)=>`${currency.toUpperCase()} ${amount.toFixed(2)}`;

export type WalletReadiness={
  ready:boolean;
  code:"READY"|"WALLET_REVOKED"|"WALLET_EXPIRED"|"NO_REMAINING_AUTHORITY"|"WALLET_EXPIRES_TOO_SOON_FOR_PAYMENT";
  message:string;
  remainingAuthority:number;
  validUntil:string;
  millisecondsRemaining:number;
};

export function getWalletReadiness(
  wallet:IntentWallet,
  now=new Date(),
  minimumPaymentWindowMs=15*60*1000
):WalletReadiness{
  const remainingAuthority=Math.max(0,wallet.totalAuthority-wallet.spentAmount);
  const validUntilMs=new Date(wallet.validUntil).getTime();
  const millisecondsRemaining=Number.isFinite(validUntilMs)?validUntilMs-now.getTime():0;

  if(wallet.status!=="ACTIVE") return {
    ready:false,code:"WALLET_REVOKED",message:"This Intent Wallet has been revoked.",
    remainingAuthority,validUntil:wallet.validUntil,millisecondsRemaining
  };
  if(millisecondsRemaining<=0) return {
    ready:false,code:"WALLET_EXPIRED",message:`This Intent Wallet expired at ${wallet.validUntil}.`,
    remainingAuthority,validUntil:wallet.validUntil,millisecondsRemaining
  };
  if(remainingAuthority<=0) return {
    ready:false,code:"NO_REMAINING_AUTHORITY",message:"This Intent Wallet has no remaining spending authority.",
    remainingAuthority,validUntil:wallet.validUntil,millisecondsRemaining
  };
  if(millisecondsRemaining<minimumPaymentWindowMs) return {
    ready:false,code:"WALLET_EXPIRES_TOO_SOON_FOR_PAYMENT",
    message:"This Intent Wallet has less than 15 minutes remaining, so a new payment cannot be safely started.",
    remainingAuthority,validUntil:wallet.validUntil,millisecondsRemaining
  };
  return {
    ready:true,code:"READY",message:"Wallet authority is active and has enough time remaining to start payment.",
    remainingAuthority,validUntil:wallet.validUntil,millisecondsRemaining
  };
}

export function evaluateWalletTransaction(
  wallet:IntentWallet,
  tx:WalletTransaction,
  now=new Date()
):WalletEvaluation{
  const violations:string[]=[];
  const reasons:string[]=[];
  const remaining=Math.max(0,wallet.totalAuthority-wallet.spentAmount);

  if(!validMoney(tx?.amount,tx?.currency)||!Number.isSafeInteger(tx?.quantity)||tx.quantity<1||
     !Array.isArray(tx.features)||!tx.features.every(x=>typeof x==='string')||typeof tx.brand!=='string'||typeof tx.category!=='string'||
     !validMoney(wallet.totalAuthority,wallet.currency)||!validMoney(wallet.spentAmount,wallet.currency,true)||
     !validMoney(wallet.autoBuyLimit,wallet.currency,true)||!validMoney(wallet.maxSingleTransaction,wallet.currency)||
     !Number.isFinite(Date.parse(wallet.validUntil))||
     (tx.presentmentAmount!==undefined&&!validMoney(tx.presentmentAmount,tx.presentmentCurrency))||
     (tx.presentmentCurrency!==undefined&&!validCurrency(tx.presentmentCurrency))){
    return {decision:'BLOCK',violations:['INVALID_FINANCIAL_INPUT'],reasons:['Malformed monetary, quantity, currency or wallet facts.'],remainingAuthority:remaining,requestedAmount:tx?.amount,additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:false};
  }

  if(wallet.status!=="ACTIVE"){
    violations.push("WALLET_REVOKED");
    reasons.push("Wallet is revoked and cannot authorize new transactions.");
  }
  if(new Date(wallet.validUntil).getTime()<=now.getTime()){
    violations.push("WALLET_EXPIRED");
    reasons.push(`Wallet authority expired at ${wallet.validUntil}. Create or select a fresh wallet.`);
  }
  if(tx.currency.toUpperCase()!==wallet.currency.toUpperCase()){
    violations.push("CURRENCY_MISMATCH");
    reasons.push("Transaction must be normalized into the wallet authority currency before policy evaluation.");
  }
  if(tx.amount>wallet.maxSingleTransaction){
    violations.push("MAX_SINGLE_TRANSACTION_EXCEEDED");
    reasons.push(`${amountLabel(tx.amount,wallet.currency)} exceeds the hard per-transaction ceiling of ${amountLabel(wallet.maxSingleTransaction,wallet.currency)}.`);
  }
  if(tx.amount>remaining){
    violations.push("REMAINING_AUTHORITY_EXCEEDED");
    reasons.push(`${amountLabel(tx.amount,wallet.currency)} exceeds the wallet's remaining authority of ${amountLabel(remaining,wallet.currency)}.`);
  }
  if(wallet.allowedCategories.length && !has(wallet.allowedCategories,tx.category)){
    violations.push("CATEGORY_NOT_ALLOWED");
    reasons.push(`Category '${tx.category}' is outside this wallet's allowed categories: ${wallet.allowedCategories.join(", ")}.`);
  }
  if(has(wallet.blockedBrands,tx.brand)){
    violations.push("BRAND_BLOCKED");
    reasons.push(`Brand '${tx.brand}' is explicitly blocked by this wallet.`);
  }
  if(wallet.allowedBrands.length && !has(wallet.allowedBrands,tx.brand)){
    violations.push("BRAND_NOT_ALLOWED");
    reasons.push(`Brand '${tx.brand}' is not in this wallet's allowed brands: ${wallet.allowedBrands.join(", ")}.`);
  }

  for(const feature of wallet.requiredFeatures){
    if(!has(tx.features,feature)){
      violations.push("REQUIRED_FEATURE_MISSING");
      reasons.push(`Missing required feature: ${feature}.`);
    }
  }

  // No current adapter independently attests product condition. Merchant text,
  // model inference and browser assertions cannot clear a strict condition rule.
  if(wallet.excludedConditions?.length){
    violations.push('PRODUCT_CONDITION_UNVERIFIED');
    reasons.push('Required product condition cannot be independently verified; excluded: '+wallet.excludedConditions.join(', ')+'.');
  }

  if(violations.length){
    return {decision:"BLOCK",violations,reasons,remainingAuthority:remaining,requestedAmount:tx.amount,additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:false};
  }

  if(tx.amount>wallet.autoBuyLimit){
    const extra=tx.amount-wallet.autoBuyLimit;
    return {
      decision:"STEP_UP",violations:[],
      reasons:[`The transaction is valid, but it is ${amountLabel(extra,wallet.currency)} above the autonomous limit. Human step-up can authorize this exact quote.`],
      remainingAuthority:remaining,requestedAmount:tx.amount,
      additionalAuthorityRequired:extra,canAutoExecute:false,requiresHumanApproval:true
    };
  }

  return {
    decision:"ALLOW",violations:[],
    reasons:["Transaction is fully inside delegated autonomous authority."],
    remainingAuthority:remaining,requestedAmount:tx.amount,
    additionalAuthorityRequired:0,canAutoExecute:true,requiresHumanApproval:false
  };
}

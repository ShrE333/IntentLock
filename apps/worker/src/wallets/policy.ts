import type {IntentWallet, WalletTransaction, WalletEvaluation} from "./types";

const norm=(s:string)=>s.trim().toLowerCase();
const has=(xs:string[],x:string)=>xs.map(norm).includes(norm(x));

export function evaluateWalletTransaction(
  wallet:IntentWallet,
  tx:WalletTransaction,
  now=new Date()
):WalletEvaluation{
  const violations:string[]=[];
  const reasons:string[]=[];
  const remaining=Math.max(0,wallet.totalAuthority-wallet.spentAmount);

  if(wallet.status!=="ACTIVE"){violations.push("WALLET_REVOKED");reasons.push("Wallet is revoked.");}
  if(new Date(wallet.validUntil).getTime()<=now.getTime()){violations.push("WALLET_EXPIRED");reasons.push("Wallet authority has expired.");}
  if(tx.currency.toUpperCase()!==wallet.currency.toUpperCase()){violations.push("CURRENCY_MISMATCH");}
  if(tx.amount>wallet.maxSingleTransaction){violations.push("MAX_SINGLE_TRANSACTION_EXCEEDED");}
  if(tx.amount>remaining){violations.push("REMAINING_AUTHORITY_EXCEEDED");}
  if(wallet.allowedCategories.length && !has(wallet.allowedCategories,tx.category)){violations.push("CATEGORY_NOT_ALLOWED");}
  if(has(wallet.blockedBrands,tx.brand)){violations.push("BRAND_BLOCKED");}
  if(wallet.allowedBrands.length && !has(wallet.allowedBrands,tx.brand)){violations.push("BRAND_NOT_ALLOWED");}

  for(const feature of wallet.requiredFeatures){
    if(!has(tx.features,feature)){violations.push("REQUIRED_FEATURE_MISSING");reasons.push(`Missing required feature: ${feature}`);}
  }

  if(violations.length){
    return {decision:"BLOCK",violations,reasons,remainingAuthority:remaining,requestedAmount:tx.amount,additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:false};
  }

  if(tx.amount>wallet.autoBuyLimit){
    const extra=tx.amount-wallet.autoBuyLimit;
    return {
      decision:"STEP_UP",violations:[],
      reasons:[`Valid transaction, but ₹${extra} additional one-time authority is required.`],
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

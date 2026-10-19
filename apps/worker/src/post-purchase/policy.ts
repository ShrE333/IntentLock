import type {RefundPolicyInput,RefundPolicyResult} from "./types";

const EPS=0.000001;

export function evaluateRefundPolicy(input:RefundPolicyInput):RefundPolicyResult{
  const violations:string[]=[];
  const reasons:string[]=[];
  const requestedCurrency=input.requestedCurrency.trim().toUpperCase();
  const captureCurrency=input.captureCurrency.trim().toUpperCase();
  const refundableRemaining=Math.max(0,input.captureAmount-input.alreadyReservedAmount);

  if(input.sessionStatus!=="CAPTURED"){
    violations.push("SESSION_NOT_CAPTURED");
    reasons.push("Only a captured PurchaseSession can be refunded.");
  }
  if(input.paymentStatus!=="COMPLETED"){
    violations.push("PAYMENT_NOT_COMPLETED");
    reasons.push("The provider payment must be completed before refund authority exists.");
  }
  if(input.provider!=="paypal"){
    violations.push("REFUND_PROVIDER_NOT_SUPPORTED");
    reasons.push("V11.4 executes refunds through the PayPal capture refund API only.");
  }
  if(!Number.isFinite(input.requestedAmount)||input.requestedAmount<=0){
    violations.push("INVALID_REFUND_AMOUNT");
    reasons.push("Refund amount must be greater than zero.");
  }
  if(requestedCurrency!==captureCurrency){
    violations.push("REFUND_CURRENCY_MISMATCH");
    reasons.push(`Refund currency must remain ${captureCurrency}.`);
  }
  if(input.requestedAmount-refundableRemaining>EPS){
    violations.push("REFUND_EXCEEDS_REMAINING_CAPTURE");
    reasons.push(`Only ${captureCurrency} ${refundableRemaining.toFixed(2)} remains refundable.`);
  }
  if(input.capturedAt){
    const now=input.now??new Date();
    const ageDays=(now.getTime()-new Date(input.capturedAt).getTime())/(24*60*60*1000);
    if(ageDays>input.maxAgeDays){
      violations.push("REFUND_WINDOW_EXPIRED");
      reasons.push(`Refund request is outside the ${input.maxAgeDays}-day IntentLock policy window.`);
    }
  }else{
    violations.push("CAPTURE_TIMESTAMP_MISSING");
    reasons.push("IntentLock cannot prove when the payment was captured.");
  }
  if(input.blockOnOpenDispute&&input.openDisputeCount>0){
    violations.push("OPEN_DISPUTE_PRESENT");
    reasons.push("An unresolved PayPal dispute exists for this capture; automatic refund is blocked to prevent double reimbursement.");
  }

  return {decision:violations.length?"BLOCK":"ALLOW",violations,reasons,refundableRemaining};
}

export function calculateWalletRefundCredit(input:{
  requestedPresentmentAmount:number;
  originalPresentmentAmount:number;
  originalWalletDebit:number;
}){
  if(input.originalPresentmentAmount<=0||input.originalWalletDebit<=0)
    throw new Error("INVALID_ORIGINAL_PAYMENT_CONTEXT");
  const ratio=input.requestedPresentmentAmount/input.originalPresentmentAmount;
  if(!Number.isFinite(ratio)||ratio<=0||ratio>1.000001)
    throw new Error("INVALID_REFUND_RATIO");
  // Wallets currently use NUMERIC(14,2). Restore authority using the exact
  // historical authorization ratio, never a new FX quote.
  return Math.round(input.originalWalletDebit*ratio*100)/100;
}

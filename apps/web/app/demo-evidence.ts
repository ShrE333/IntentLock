export function demoStages(session:{selectedDecision?:string|null;quoteHash?:string|null}|null,events:{eventType:string}[],verifiedProof=false){
  const types=new Set(events.map(e=>e.eventType));
  return [Boolean(session),Boolean(session?.selectedDecision),types.has('PAYEE_IDENTITY_BOUND')&&types.has('COMMERCE_QUOTE_REVALIDATED'),types.has('PAYPAL_AUTHORIZED')&&types.has('PAYPAL_CAPTURE_REQUESTED'),verifiedProof];
}
export function sandboxServicesReady(provider:{paypalConfigured?:boolean;paypalEnvironment?:string;recipientMappingConfigured?:boolean}){
  return provider.paypalConfigured===true&&provider.paypalEnvironment==='sandbox'&&provider.recipientMappingConfigured===true;
}
export function sandboxWalletAvailable(wallet:{totalAuthority:number;spentAmount:number;reservedAmount?:number}){
  const {totalAuthority,spentAmount,reservedAmount}=wallet;
  if(![totalAuthority,spentAmount,reservedAmount].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))return 0;
  return Math.max(0,totalAuthority-spentAmount-reservedAmount!);
}
export function demoWindowExpired(endDate:string,now=Date.now()){
  const end=Date.parse(`${endDate}T23:59:59Z`);
  return !/^\d{4}-\d{2}-\d{2}$/.test(endDate)||!Number.isFinite(end)||new Date(end).toISOString().slice(0,10)!==endDate||now>end;
}

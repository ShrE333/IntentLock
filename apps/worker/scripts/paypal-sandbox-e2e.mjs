import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {randomUUID} from 'node:crypto';
import {workerOrigin,readJson} from './sandbox-tools.mjs';

// Real sandbox only. No mock provider, database writes, webhook forgery, or automatic capture.
// Token stays in this process. If interrupted, use the browser's own capability or operator recovery.
const cli=createInterface({input:stdin,output:stdout});
const results={mode:'REAL_SANDBOX',oauth:'NOT_TESTED',checkout:'NOT_TESTED',capture:'NOT_TESTED',webhook:'NOT_TESTED',settlement:'NOT_TESTED',proof:'NOT_TESTED',queue:'REQUIRES_OPERATOR_LOGS'};
let token;
async function call(path,body){
  return readJson(workerOrigin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`} :{}),'x-intentlock-request-id':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function confirm(text,expected){if((await cli.question(text+` Type ${expected}: `))!==expected)throw new Error('OPERATOR_STOPPED');}
function assert(value,message){if(!value)throw new Error(message);}
try{
  const provider=await call('/api/payments/provider');
  assert(provider.paypalEnvironment==='sandbox'&&provider.paypalReadiness?.ready,'CONFIGURATION_BLOCKED');
  if(!process.argv.includes('--interactive'))throw new Error('READINESS_ONLY: pass --interactive to prepare a real sandbox purchase');
  await confirm('Confirm isolated demo database, queue and authorized sandbox merchant; no live credentials.','SANDBOX');
  const access=await call('/api/access/demo',{});token=access.token;
  assert(/^ildemo_[a-f0-9]{64}$/.test(token??''),'CAPABILITY_INVALID');
  const {wallet}=await call('/api/wallets',{name:'PayPal sandbox lifecycle',countryCode:'US',currency:'USD',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:['electronics'],allowedBrands:['Sony'],blockedBrands:['Boat'],requiredFeatures:['wireless','ANC'],validUntil:new Date(Date.now()+23*3600000).toISOString()});
  const created=await call('/api/sessions',{walletId:wallet.walletId,connectorId:'paypal-demo-marketplace',prompt:'Find Sony WH-CH720N wireless ANC headphones',channel:'WEB'});
  const path='/api/sessions/'+encodeURIComponent(created.session.sessionId);
  const {session}=await call(path+'/run',{});
  assert(session.selectedDecision==='ALLOW'&&session.selectedProduct?.id==='pp_sony_49','EXPECTED_DETERMINISTIC_PRODUCT_AND_ALLOW');
  assert(session.selectedProduct.authorizationContext?.recipient?.environment==='sandbox','TRUSTED_RECIPIENT_REQUIRED');
  const prepared=await call(path+'/payment',{});
  const approval=new URL(prepared.payment.checkoutUrl);
  assert(approval.protocol==='https:'&&approval.hostname==='www.sandbox.paypal.com','SANDBOX_APPROVAL_URL_REQUIRED');
  results.checkout='ORDER_CREATED';
  console.log('Session:',session.sessionId,'Wallet:',wallet.walletId);
  console.log('Open in a browser and approve with the separate sandbox buyer:',approval.href);
  console.log('The browser return cannot carry this CLI capability. Return here after buyer approval; do not create another payment.');
  await confirm('Authorize the approved sandbox order (funds held).','AUTHORIZE');
  await call(path+'/payment/authorize',{});
  results.checkout='AUTHORIZED';
  await confirm('Capture USD 49.00 from that sandbox authorization.','CAPTURE 49.00 USD');
  await call(path+'/payment/capture',{});results.capture='REQUEST_ACCEPTED_NOT_SETTLED';
  for(let i=0;i<60;i++){
    const current=await call(path);
    if(current.session.status==='CAPTURED'){
      const proof=await call(path+'/proof');
      assert(proof.verification?.verified&&proof.verification?.signatureValid&&proof.verification?.recipientVerified,'PROOF_VERIFICATION_FAILED');
      const wallets=await call('/api/wallets');const final=wallets.wallets.find(w=>w.walletId===wallet.walletId);
      assert(final&&Number(final.spentAmount)===49&&Number(final.reservedAmount)===0,'WALLET_SETTLEMENT_MISMATCH');
      results.capture='COMPLETED';results.webhook='VERIFIED_BY_SERVER_PROOF';results.settlement='49_USD_OBSERVED';results.proof='SERVER_SIGNATURE_AND_RECIPIENT_VERIFIED';
      // Duplicate capture is operator-gated even though expected to be idempotent.
      await confirm('Replay capture request to check the duplicate guard.','REPLAY');
      const duplicate=await call(path+'/payment/capture',{});assert(duplicate.duplicate===true,'DUPLICATE_GUARD_FAILED');
      const after=await call('/api/wallets');assert(Number(after.wallets.find(w=>w.walletId===wallet.walletId)?.spentAmount)===49,'DUPLICATE_DEBIT');
      results.settlement='49_USD_UNCHANGED_AFTER_CAPTURE_REPLAY';
      break;
    }
    await new Promise(r=>setTimeout(r,3000));
  }
  assert(results.proof!=='NOT_TESTED','WEBHOOK_OR_QUEUE_TIMEOUT: retain reservation and investigate; never recapture');
}catch{console.error('Sandbox lifecycle stopped or blocked. Inspect authenticated session evidence; do not retry an ambiguous capture automatically.');process.exitCode=1;}
finally{token=undefined;cli.close();console.log(JSON.stringify(results,null,2));}

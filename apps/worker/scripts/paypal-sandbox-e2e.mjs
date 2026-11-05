import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {workerOrigin,readJson,checkConfig,safeDiagnostic} from './sandbox-tools.mjs';
const assert=(value,code)=>{if(!value)throw new Error(code);};
export function validateBuyerReturn(value,sessionId,orderId){
  let url;try{url=new URL(value);}catch{throw new Error('INVALID_BUYER_RETURN');}
  assert(url.origin==='https://intentlock-web.vercel.app'&&url.pathname==='/new-purchase'&&!url.username&&!url.password&&!url.hash
    &&['paypal','sessionId','token','PayerID'].every(k=>url.searchParams.getAll(k).length===1)
    &&url.searchParams.get('paypal')==='approved'&&url.searchParams.get('sessionId')===sessionId
    &&url.searchParams.get('token')===orderId&&!!url.searchParams.get('PayerID'),'INVALID_BUYER_RETURN');
}
export function validateSettlementProof(proof,sessionId,walletId,orderId){
  const p=proof.receipt?.payload;
  assert(proof.verification?.verified&&proof.verification?.signatureValid&&proof.verification?.recipientVerified
    &&p?.session?.sessionId===sessionId&&p?.wallet?.walletId===walletId&&p?.payment?.providerOrderId===orderId
    &&p?.payment?.provider==='paypal'&&p?.payment?.amount===49&&p?.payment?.currency==='USD'
    &&p?.walletSpend?.amount===49&&p?.walletSpend?.currency==='USD'&&p?.walletSpend?.ledgerId,'PROOF_VERIFICATION_FAILED');
  assert(p.payment.webhookSignatureVerified===true&&p.payment.capturedStateSource==='VERIFIED_PROVIDER_WEBHOOK','MISSING_VERIFIED_WEBHOOK');
}
// Injectable only for isolated tests. CLI always uses the real Worker transport.
export async function runSandbox({question,log=console.log,request=readJson,configCheck=checkConfig,interactive=false,
  sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=60}={}){
  let stage='configuration',token,expiresAt;
  const results={mode:'REAL_SANDBOX',oauth:'NOT_TESTED',checkout:'NOT_TESTED',capture:'NOT_TESTED',webhook:'NOT_TESTED',settlement:'NOT_TESTED',proof:'NOT_TESTED',queue:'REQUIRES_OPERATOR_LOGS',webhookReplay:'REQUIRES_OPERATOR_PROVIDER_REDELIVERY'};
  async function call(path,body){
    if(token)assert(Date.parse(expiresAt)>Date.now(),'CAPABILITY_EXPIRED');
    return request(workerOrigin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',
      ...(token?{authorization:'Bearer '+token}:{}),'x-intentlock-request-id':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function confirm(prompt,expected){assert(await question(prompt+' Type '+expected+': ')===expected,'OPERATOR_STOPPED');}
  try{
    await configCheck();stage='readiness';
    const provider=await call('/api/payments/provider');
    assert(provider.paypalEnvironment==='sandbox'&&provider.paypalReadiness?.ready,'CONFIGURATION_BLOCKED');
    assert(interactive,'READINESS_ONLY');stage='operator_confirmation';
    await confirm('Confirm isolated demo database, queue and authorized sandbox merchant; no live credentials.','SANDBOX');
    stage='demo_capability';
    const access=await call('/api/access/demo',{});token=access.token;expiresAt=access.expiresAt;
    assert(/^ildemo_[a-f0-9]{64}$/.test(token??''),'CAPABILITY_INVALID');
    assert(Number.isFinite(Date.parse(expiresAt))&&Date.parse(expiresAt)>Date.now()&&Date.parse(expiresAt)<=Date.now()+31*60000,'CAPABILITY_EXPIRED');
    stage='wallet_creation';
    const {wallet}=await call('/api/wallets',{name:'PayPal sandbox lifecycle',countryCode:'US',currency:'USD',totalAuthority:100,autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:['electronics'],allowedBrands:['Sony'],blockedBrands:['Boat'],requiredFeatures:['wireless','ANC'],validUntil:new Date(Date.now()+23*3600000).toISOString()});
    stage='session_creation';
    const created=await call('/api/sessions',{walletId:wallet.walletId,connectorId:'paypal-demo-marketplace',prompt:'Find Sony WH-CH720N wireless ANC headphones',channel:'WEB'});
    const path='/api/sessions/'+encodeURIComponent(created.session.sessionId);
    log('Session: '+created.session.sessionId+' Wallet: '+wallet.walletId);
    stage='product_selection';
    const {session}=await call(path+'/run',{});
    assert(session.selectedDecision==='ALLOW'&&session.selectedProduct?.id==='pp_sony_49'&&session.selectedProduct.price===49&&session.selectedProduct.currency==='USD','EXPECTED_DETERMINISTIC_PRODUCT_AND_ALLOW');
    stage='recipient_binding';
    const recipient=session.selectedProduct.authorizationContext?.recipient;
    assert(recipient?.environment==='sandbox'&&recipient.provider==='paypal'&&recipient.connectorId==='paypal-demo-marketplace'&&recipient.fingerprint&&Date.parse(recipient.validUntil)>Date.now(),'TRUSTED_RECIPIENT_REQUIRED');
    stage='checkout_order';
    results.oauth='WORKER_OAUTH_NOT_INDEPENDENTLY_OBSERVED';
    const prepared=await call(path+'/payment',{}),payment=prepared.payment;
    const approval=new URL(payment.checkoutUrl);
    assert(approval.protocol==='https:'&&approval.hostname==='www.sandbox.paypal.com'&&!approval.username&&!approval.password&&!approval.port
      &&approval.searchParams.getAll('token').length===1&&approval.searchParams.get('token')===payment.providerOrderId,'SANDBOX_APPROVAL_URL_REQUIRED');
    assert(payment.provider==='paypal'&&payment.amount===49&&payment.currency==='USD'&&payment.providerOrderId,'EXPECTED_DETERMINISTIC_PRODUCT_AND_ALLOW');
    results.oauth='WORKER_ORDER_CREATION_SUCCEEDED';results.checkout='ORDER_CREATED';
    log('Open with the separate sandbox buyer: '+approval.href);
    log('Return to this CLI after approval. Do not create another payment in the browser.');
    stage='buyer_approval';
    validateBuyerReturn(await question('Paste buyer return URL (kept in memory; do not enable terminal recording): '),session.sessionId,payment.providerOrderId);
    stage='authorization';await confirm('Authorize the approved sandbox order (funds held).','AUTHORIZE');
    await call(path+'/payment/authorize',{});results.checkout='AUTHORIZED';
    stage='capture_confirmation';await confirm('Capture USD 49.00 from this authorization.','CAPTURE 49.00 USD');
    stage='capture_request';results.capture='REQUEST_STARTED_OUTCOME_UNKNOWN';
    await call(path+'/payment/capture',{});results.capture='REQUEST_ACCEPTED_NOT_SETTLED';
    stage='webhook_and_settlement';
    for(let i=0;i<attempts;i++){
      const current=await call(path);
      if(current.session.status==='CAPTURED'){
        stage='proof_verification';const proof=await call(path+'/proof');
        validateSettlementProof(proof,session.sessionId,wallet.walletId,payment.providerOrderId);
        stage='reservation';const state=await call(path+'/payment');
        assert(state.reservation?.state==='COMMITTED','RESERVATION_NOT_RELEASED');
        stage='wallet_settlement';const wallets=await call('/api/wallets');
        const final=wallets.wallets.find(w=>w.walletId===wallet.walletId);
        assert(final&&Number(final.spentAmount)===49&&Number(final.reservedAmount)===0,'WALLET_SETTLEMENT_MISMATCH');
        results.capture='COMPLETED';results.webhook='VERIFIED_BY_SERVER_PROOF';results.settlement='49_USD_OBSERVED';results.proof='SERVER_HMAC_AND_RECIPIENT_VERIFIED';
        stage='duplicate_capture';await confirm('Replay capture after verified settlement to check duplicate guard.','REPLAY');
        const duplicate=await call(path+'/payment/capture',{});assert(duplicate.duplicate===true,'DUPLICATE_GUARD_FAILED');
        const after=await call('/api/wallets');const w=after.wallets.find(w=>w.walletId===wallet.walletId);
        assert(Number(w?.spentAmount)===49&&Number(w?.reservedAmount)===0,'DUPLICATE_DEBIT');
        const repeated=await call(path+'/proof');validateSettlementProof(repeated,session.sessionId,wallet.walletId,payment.providerOrderId);
        assert(repeated.receipt.receiptId===proof.receipt.receiptId&&repeated.receipt.payload.walletSpend.ledgerId===proof.receipt.payload.walletSpend.ledgerId,'DUPLICATE_DEBIT');
        results.settlement='49_USD_UNCHANGED_AFTER_CAPTURE_REPLAY';
        // Financial observations cannot prove hosted queue ack or actual event
        // redelivery. Never report a complete E2E pass from these reads alone.
        return {ok:true,complete:false,results};
      }
      await sleep(3000);
    }
    throw new Error('WEBHOOK_OR_QUEUE_TIMEOUT');
  }catch(error){const diagnostic=safeDiagnostic(error,stage);log(JSON.stringify(diagnostic));
    log('Stopped. Retain authenticated session evidence; never retry an ambiguous capture automatically.');return {ok:false,results,diagnostic};
  }finally{token=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const cli=createInterface({input:stdin,output:stdout});
  try{const outcome=await runSandbox({question:q=>cli.question(q),interactive:process.argv.includes('--interactive')});
    console.log(JSON.stringify(outcome.results,null,2));
    if(!outcome.ok)process.exitCode=1;
    else if(!outcome.complete){console.log('Financial flow observed; full E2E verification still requires queue ack logs and original provider event redelivery evidence.');process.exitCode=2;}
  }finally{cli.close();}
}

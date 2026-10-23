import {findApiClientByHash} from '../authorize/repository';
import {safeEqualText} from '../authorize/crypto';
import {ACCESS_CONTEXT,AccessError,DEMO_SCOPES,hasScope,newDemoToken,sha256,type Identity,type Permission} from './identity';
import * as store from './repository';

export type FinancialAccessEnv={DATABASE_URL?:string;DEMO_ACCESS_ENABLED?:string;PAYPAL_ENV?:string;TRUSTOPS_ADMIN_TOKEN?:string;INTENTLOCK_ADMIN_KEY?:string};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const bearer=(r:Request)=>r.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1]??r.headers.get('x-intentlock-key')??'';
const sandbox=(env:FinancialAccessEnv)=>env.DEMO_ACCESS_ENABLED==='true'&&String(env.PAYPAL_ENV??'sandbox').toLowerCase()==='sandbox';
export async function authenticate(request:Request,env:FinancialAccessEnv):Promise<Identity>{
 const ops=request.headers.get('x-intentlock-ops-token');
 if(ops){if(!env.TRUSTOPS_ADMIN_TOKEN||!safeEqualText(ops,env.TRUSTOPS_ADMIN_TOKEN))throw new AccessError(401,'UNAUTHORIZED');return {kind:'ops',principalId:'ops:trustops',scopes:['*']};}
 const token=bearer(request);if(!token)throw new AccessError(401,'AUTHENTICATION_REQUIRED');
 if(!env.DATABASE_URL)throw new AccessError(503,'ACCESS_CONTROL_UNAVAILABLE');
 if(token.startsWith('ildemo_')){
   if(!sandbox(env))throw new AccessError(403,'SANDBOX_ACCESS_DISABLED');
   if(!/^ildemo_[a-f0-9]{64}$/.test(token))throw new AccessError(401,'INVALID_CAPABILITY');
   const row=await store.capabilityByHash(env.DATABASE_URL,await sha256(token));
   if(!row||!String(row.principal_id).startsWith('demo:')||!Number.isFinite(Date.parse(String(row.expires_at)))||Date.parse(String(row.expires_at))<=Date.now())throw new AccessError(401,'INVALID_OR_EXPIRED_CAPABILITY');
   return {kind:'demo',principalId:String(row.principal_id),scopes:DEMO_SCOPES,expiresAt:new Date(String(row.expires_at)).toISOString()};
 }
 const client=await findApiClientByHash(env.DATABASE_URL,await sha256(token));
 if(!client||client.status!=='ACTIVE')throw new AccessError(401,'INVALID_API_KEY');
 return {kind:'api',principalId:`api:${client.clientId}`,scopes:client.scopes};
}
export async function boundedBody(request:Request):Promise<Record<string,any>>{
 if(Number(request.headers.get('content-length')??0)>16384)throw new AccessError(413,'REQUEST_TOO_LARGE');
 const reader=request.clone().body?.getReader();if(!reader)throw new AccessError(400,'INVALID_JSON');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){void reader.cancel().catch(()=>{});throw new AccessError(413,'REQUEST_TOO_LARGE');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw 0;return body;}catch{throw new AccessError(400,'INVALID_JSON');}
}
type Rule={scope:string;kind?:'wallet'|'session'|'refund'|'intent'|'audit'|'risk';id?:string;permission?:Permission;ops?:boolean;bodyKey?:'walletId'|'intent'};
// Default deny: adding a financial route requires adding an explicit rule.
export function accessRule(path:string,method:string):Rule|null{
 const post=method==='POST',get=method==='GET';let m:RegExpMatchArray|null;
 if(path==='/api/wallets')return post?{scope:'wallet:create'}:get?{scope:'financial:read'}:null;
 if((m=path.match(/^\/api\/wallets\/([^/]+)\/evaluate$/))&&post)return {scope:'wallet:evaluate',kind:'wallet',id:m[1],permission:'authorize'};
 if((m=path.match(/^\/api\/wallets\/([^/]+)\/step-up\/[^/]+\/resolve$/))&&post)return {scope:'stepup:resolve',kind:'wallet',id:m[1],permission:'approve'};
 if(path==='/api/sessions')return post?{scope:'session:create',kind:'wallet',bodyKey:'walletId',permission:'execute'}:get?{scope:'financial:read'}:null;
 if((m=path.match(/^\/api\/sessions\/([^/]+)(?:\/(run|step-up\/resolve|payment(?:-link)?(?:\/(?:authorize|capture))?|proof))?$/))){
   if(get&&(!m[2]||['payment','payment-link','proof'].includes(m[2])))return {scope:'financial:read',kind:'session',id:m[1],permission:'read'};
   if(post&&m[2]&&m[2]!=='proof')return {scope:m[2]==='run'?'session:run':m[2]==='step-up/resolve'?'stepup:resolve':'payment:execute',kind:'session',id:m[1],permission:m[2]==='step-up/resolve'?'approve':'execute'};
 }
 if(path==='/api/commerce/search'&&post)return {scope:'commerce:search',kind:'wallet',bodyKey:'walletId',permission:'read'};
 if(path==='/api/commerce/shopify/status'&&get)return {scope:'ops',ops:true};
 if((m=path.match(/^\/api\/risk\/wallet\/([^/]+)\/summary$/))&&get)return {scope:'financial:read',kind:'wallet',id:m[1],permission:'read'};
 if((m=path.match(/^\/api\/risk\/session\/([^/]+)$/))&&get)return {scope:'financial:read',kind:'risk',id:m[1],permission:'read'};
 if(path==='/api/risk/evaluate'&&post)return {scope:'legacy:evaluate'};
 if(['/api/trust-center/overview','/api/trust-center/reconciliation'].includes(path)&&get)return {scope:'financial:read'};
 if(path==='/api/trust-center/payees'&&get)return {scope:'ops',ops:true};
 if((m=path.match(/^\/api\/trust-center\/reconciliation\/([^/]+)\/reconcile$/))&&post)return {scope:'ops',ops:true,kind:'session',id:m[1]};
 if((m=path.match(/^\/api\/trust-center\/(?:disputes\/evidence|post-purchase|disputes\/paypal\/session)\/([^/]+)$/))&&get)return {scope:'financial:read',kind:'session',id:m[1],permission:'read'};
 if((m=path.match(/^\/api\/trust-center\/refunds\/(evaluate|request)\/([^/]+)$/))&&post)return {scope:m[1]==='evaluate'?'refund:evaluate':'ops',ops:m[1]==='request',kind:'session',id:m[2],permission:'read'};
 if((m=path.match(/^\/api\/trust-center\/refunds\/([^/]+)\/sync$/))&&post)return {scope:'ops',ops:true,kind:'refund',id:m[1]};
 if(/^\/api\/trust-center\/disputes\/paypal\/[^/]+(?:\/send-summary)?$/.test(path))return {scope:'ops',ops:true};
 if((m=path.match(/^\/api\/audit\/([^/]+)$/))&&get)return {scope:'financial:read',kind:'audit',id:m[1],permission:'read'};
 if(path==='/api/intents/parse'&&post)return {scope:'intent:create'};
 if(path==='/api/evals'&&get)return {scope:'financial:read'};
 if(path==='/api/evaluate'&&post)return {scope:'legacy:evaluate'};
 if(['/api/approvals/create','/api/approvals/verify','/api/security/prompt-injection-demo','/api/security/stale-price-demo','/api/security/duplicate-checkout-demo'].includes(path)&&post)return {scope:'legacy:evaluate',kind:'intent',bodyKey:'intent'};
 if(path==='/api/payments/create-link'&&post)return {scope:'ops',ops:true};
 if(path.startsWith('/agents/'))return {scope:'ops',ops:true};
 return null;
}
const publicPaths=new Set(['/health','/api/commerce/connectors','/api/payments/provider','/api/payments/capabilities','/api/risk/status','/api/whatsapp/status']);
const providerHooks=new Set(['/webhooks/paypal','/webhooks/razorpay','/webhooks/waha']);
export async function secureFinancialRequest<T extends FinancialAccessEnv>(request:Request,env:T,next:(r:Request,e:T)=>Promise<Response>):Promise<Response>{
 const url=new URL(request.url);const path=url.pathname;
 try{
   // Provider ingress authenticates its own raw body, never a browser identity.
   if(request.method==='OPTIONS'||(request.method==='GET'&&publicPaths.has(path))||(request.method==='POST'&&providerHooks.has(path)))return next(request,env);
   if(path==='/v1/status'||path==='/v1/authorize'||path==='/v1/verify'||path.startsWith('/v1/admin/clients'))return next(request,env);
   if(path.startsWith('/v1/admin/wallet-grants')){const {handleGrantAdmin}=await import('./grant-admin');return handleGrantAdmin(request,env);}
   const rule=accessRule(path,request.method);
   if(!rule&&!['/api/access/demo','/api/access/refresh','/api/access/logout'].includes(path))return json({error:'NOT_FOUND'},404);
   if(path!=='/api/access/demo'&&!bearer(request)&&!request.headers.has('x-intentlock-ops-token'))throw new AccessError(401,'AUTHENTICATION_REQUIRED');
   if(!env.DATABASE_URL)throw new AccessError(503,'ACCESS_CONTROL_UNAVAILABLE');
   const db=env.DATABASE_URL;
   const ip=await sha256(`financial-access-v1|${request.headers.get('cf-connecting-ip')??'unavailable'}`);
   if(!await store.rateLimit(db,`request-ip:${ip}`,120,60))throw new AccessError(429,'RATE_LIMITED');
   if(path==='/api/access/demo'&&request.method==='POST'){
     if(!sandbox(env))throw new AccessError(503,'SANDBOX_ACCESS_DISABLED');
     if(!await store.rateLimit(db,`issue:${ip}`,3,3600)||!await store.rateLimit(db,'issue:global',200,3600))throw new AccessError(429,'DEMO_ISSUANCE_LIMIT');
     const token=newDemoToken();const principal=`demo:${crypto.randomUUID()}`;const expiresAt=new Date(Date.now()+30*60000).toISOString();
     await store.createCapability(db,await sha256(token),principal,expiresAt);return json({token,expiresAt,scopes:DEMO_SCOPES},201);
   }
   const identity=await authenticate(request,env);
   if(!await store.rateLimit(db,`principal:${identity.principalId}`,60,60))throw new AccessError(429,'RATE_LIMITED');
   if(path==='/api/access/refresh'&&request.method==='POST'){
     if(identity.kind!=='demo')throw new AccessError(403,'DEMO_CAPABILITY_REQUIRED');
     const token=newDemoToken(),expiresAt=new Date(Date.now()+30*60000).toISOString();
     if(!await store.rotateCapability(db,await sha256(bearer(request)),await sha256(token),expiresAt))throw new AccessError(401,'CAPABILITY_ALREADY_ROTATED');
     return json({token,expiresAt,scopes:DEMO_SCOPES});
   }
   if(path==='/api/access/logout'&&request.method==='POST'){
     if(identity.kind!=='demo')throw new AccessError(403,'DEMO_CAPABILITY_REQUIRED');
     await store.revokeCapability(db,await sha256(bearer(request)));return json({ok:true});
   }
   if(!rule)return json({error:'NOT_FOUND'},404);
   if((rule.ops&&identity.kind!=='ops')||!hasScope(identity,rule.scope))throw new AccessError(403,'INSUFFICIENT_SCOPE');
   let body:Record<string,any>|undefined;
   if(request.method==='POST')body=await boundedBody(request);
   const id=rule.id?decodeURIComponent(rule.id):rule.bodyKey==='intent'?body?.intent?.id:rule.bodyKey?body?.[rule.bodyKey]:undefined;
   if(rule.kind&&identity.kind!=='ops'){
     if(typeof id!=='string'||!id)throw new AccessError(400,'RESOURCE_ID_REQUIRED');
     let allowed=false;
     if(rule.kind==='wallet')allowed=await store.hasWalletPermission(db,id,identity.principalId,rule.permission??'read');
     else if(rule.kind==='intent')allowed=await store.ownsIntent(db,id,identity.principalId);
     else {const wallet=await store.resourceWallet(db,rule.kind==='audit'?'session':rule.kind,id);allowed=wallet?await store.hasWalletPermission(db,wallet,identity.principalId,rule.permission??'read'):rule.kind==='audit'&&await store.ownsIntent(db,id,identity.principalId);}
     if(!allowed)throw new AccessError(404,'RESOURCE_NOT_FOUND');
     // Mutation responses include financial facts: a delegate needs read access
     // as well as authority to perform the requested operation.
     if(rule.permission&&rule.permission!=='read'&&rule.kind!=='intent'){
       const wallet=rule.kind==='wallet'?id:await store.resourceWallet(db,rule.kind==='audit'?'session':rule.kind,id);
       if(!wallet||!await store.hasWalletPermission(db,wallet,identity.principalId,'read'))throw new AccessError(404,'RESOURCE_NOT_FOUND');
     }
     const stepup=path.match(/^\/api\/wallets\/[^/]+\/step-up\/([^/]+)\/resolve$/);
     if(stepup&&await store.resourceWallet(db,'stepup',decodeURIComponent(stepup[1]))!==id)throw new AccessError(404,'RESOURCE_NOT_FOUND');
   }
   if(identity.kind==='demo'){
     if(path==='/api/intents/parse'&&!await store.rateLimit(db,`ai:${identity.principalId}`,3,3600))throw new AccessError(429,'DEMO_AI_LIMIT');
     if(rule.kind==='session'&&id&&!await store.isDemoSession(db,id))throw new AccessError(403,'DEMO_CONNECTOR_ONLY');
     if(path==='/api/wallets'&&request.method==='POST'){
       if(body?.currency!=='USD'||body?.totalAuthority>100||body?.maxSingleTransaction>100||Date.parse(body?.validUntil)>Date.now()+86400000)throw new AccessError(403,'DEMO_AUTHORITY_LIMIT');
       if(!await store.rateLimit(db,`wallet:${identity.principalId}`,2,3600)||!await store.rateLimit(db,`wallet-ip:${ip}`,6,3600))throw new AccessError(429,'DEMO_WALLET_LIMIT');
     }
     if((path==='/api/sessions'||path==='/api/commerce/search')&&request.method==='POST'&&body?.connectorId!=='paypal-demo-marketplace')throw new AccessError(403,'DEMO_CONNECTOR_ONLY');
     if(path==='/api/sessions'&&request.method==='POST'&&body?.channel&&body.channel!=='WEB')throw new AccessError(403,'DEMO_CHANNEL_ONLY');
     if(path==='/api/trust-center/reconciliation'&&url.searchParams.get('deep')==='1')throw new AccessError(403,'OPERATOR_REQUIRED');
     if(request.method==='POST'){
       if(!await store.rateLimit(db,`mutation:${identity.principalId}`,10,60))throw new AccessError(429,'DEMO_MUTATION_LIMIT');
       const nonce=request.headers.get('x-intentlock-request-id');if(!nonce||!/^[-a-zA-Z0-9_]{16,128}$/.test(nonce))throw new AccessError(400,'REQUEST_ID_REQUIRED');
       if(!await store.claimNonce(db,identity.principalId,nonce,identity.expiresAt!))throw new AccessError(409,'REQUEST_REPLAYED');
     }
   }
   const effective={...env,[ACCESS_CONTEXT]:identity,...(identity.kind==='demo'?{PAYMENT_PROVIDER:'paypal',PAYPAL_ENV:'sandbox'}:{})};
   const response=await next(request,effective);
   const headers=new Headers(response.headers);headers.set('cache-control','no-store');
   return response.status===101?response:new Response(response.body,{status:response.status,headers});
 }catch(error){return error instanceof AccessError?json({error:error.message},error.status):json({error:'ACCESS_CONTROL_UNAVAILABLE'},503);}
}

import {resolveApiUrl} from './runtime-config';
type Saved={token:string;expiresAt:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key='intentlock:demo-access:v1';
const publicMetadata=new Set(['/health','/api/commerce/connectors','/api/payments/provider','/api/payments/capabilities','/api/risk/status','/api/whatsapp/status']);
export function createDemoTransport(base:string,storage:Store,fetcher:typeof fetch,now=()=>Date.now(),nonce=()=>crypto.randomUUID()){
 let pending:Promise<Saved>|null=null;
 const read=():Saved|null=>{try{const s=JSON.parse(storage.getItem(key)??'null');return s&&typeof s.token==='string'&&typeof s.expiresAt==='string'?s:null;}catch{return null;}};
 async function ensure(){
   if(pending)return pending;
   pending=(async()=>{
     const saved=read();if(saved&&Date.parse(saved.expiresAt)<=now())throw new Error('Sandbox access expired. Start a new sandbox session; existing purchases remain recoverable by an operator.');
     if(saved&&Date.parse(saved.expiresAt)>now()+120000)return saved;
     const response=await fetcher(base+(saved?'/api/access/refresh':'/api/access/demo'),{method:'POST',headers:saved?{authorization:`Bearer ${saved.token}`}:{},cache:'no-store',redirect:'error'});
     const raw:unknown=await response.json();
     if(!raw||typeof raw!=='object')throw new Error('Invalid sandbox capability response.');
     const body=raw as Record<string,unknown>;
     if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'Sandbox access is unavailable.');
     if(typeof body.token!=='string'||!/^ildemo_[a-f0-9]{64}$/.test(body.token)||typeof body.expiresAt!=='string'||!Number.isFinite(Date.parse(body.expiresAt))||Date.parse(body.expiresAt)<=now())throw new Error('Invalid sandbox capability response.');
     const next={token:body.token,expiresAt:body.expiresAt};storage.setItem(key,JSON.stringify(next));return next;
   })();
   try{return await pending;}finally{pending=null;}
 }
 return {
   async fetch(input:string,init:RequestInit={}){
     const url=new URL(input,base+'/');if(url.origin!==new URL(base).origin)throw new Error('Refusing to send sandbox credentials to another origin.');
     const headers=new Headers(init.headers);if(headers.has('x-intentlock-ops-token'))throw new Error('Privileged operations require a server-side operator integration.');
     if(!publicMetadata.has(url.pathname)||(init.method??'GET')!=='GET'){
       const capability=await ensure();headers.set('authorization',`Bearer ${capability.token}`);
       if((init.method??'GET')==='POST')headers.set('x-intentlock-request-id',nonce());
     }
     return fetcher(url.toString(),{...init,headers,cache:'no-store',redirect:'error'});
   },
   async reset(){const saved=read();if(saved){try{await fetcher(base+'/api/access/logout',{method:'POST',headers:{authorization:`Bearer ${saved.token}`},cache:'no-store'});}catch{}}
     storage.removeItem(key);
   }
 };
}
let transport:ReturnType<typeof createDemoTransport>|undefined;
function current(){
 if(typeof window==='undefined')throw new Error('Sandbox capabilities are available only in the browser.');
 return transport??=createDemoTransport(resolveApiUrl(process.env.NEXT_PUBLIC_INTENTLOCK_API_URL,process.env.NODE_ENV==='production'),window.sessionStorage,globalThis.fetch.bind(globalThis));
}
export const financialFetch=(input:string,init?:RequestInit)=>current().fetch(input,init);
export async function startNewDemo(){
 if(typeof window==='undefined')return;
 try{await current().reset();}catch{try{window.sessionStorage.removeItem(key);}catch{}}
 try{window.localStorage.removeItem('intentlock:lastIntent');window.localStorage.removeItem('intentlock:lastIntentId');}catch{}
 window.location.assign('/');
}

import {identityOf,listPrincipal} from '../access/identity';
import {buildDataset} from './repository';
import {DEFAULT_WINDOW,WINDOWS,type StudioWindow} from './types';

const headers={
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});

// READ-ONLY operator analytics. GET only; no mutation of wallets, payments, refunds or TrustOps.
export async function handleControlStudioRoutes(request:Request,env:{DATABASE_URL?:string},url:URL):Promise<Response|null>{
  if(!url.pathname.startsWith('/api/control-studio'))return null;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET'||url.pathname!=='/api/control-studio/dataset')return json({error:'NOT_FOUND'},404);
  if(!env.DATABASE_URL)return json({error:'DATABASE_NOT_CONFIGURED'},500);
  const identity=identityOf(env);
  if(!identity)return json({error:'UNAUTHENTICATED'},401);
  const w=url.searchParams.get('window')??DEFAULT_WINDOW;
  if(!Object.prototype.hasOwnProperty.call(WINDOWS,w))return json({error:'INVALID_WINDOW',allowed:Object.keys(WINDOWS)},400);
  try{return json(await buildDataset(env.DATABASE_URL,listPrincipal(env),w as StudioWindow));}
  catch{return json({error:'CONTROL_STUDIO_UNAVAILABLE'},500);}
}

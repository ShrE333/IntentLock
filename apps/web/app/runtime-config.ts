export function resolveApiUrl(configured:string|undefined,production:boolean){
  if(configured){
    const url=new URL(configured);
    if(!['https:','http:'].includes(url.protocol)||(production&&url.protocol!=='https:')) throw new Error('IntentLock API URL must use HTTPS in production.');
    return configured.replace(/\/+$/,'');
  }
  if(production) throw new Error('IntentLock API is unavailable: NEXT_PUBLIC_INTENTLOCK_API_URL is not configured.');
  return 'http://localhost:8787';
}
export async function refreshWithError(refresh:()=>Promise<unknown>,onError:(error:unknown)=>void){
  try{await refresh();}catch(error){onError(error);}
}

/**
 * Global browser preflight contract. Keep this dependency-free so it can be
 * validated by Node/Vitest without importing Cloudflare's Worker runtime.
 */
export const CORS_ALLOWED_HEADERS = 'content-type,x-razorpay-signature,x-intentlock-ops-token,authorization,x-intentlock-key,x-intentlock-request-id';
export function originAllowed(request:Request,env:{CORS_ALLOWED_ORIGINS?:string}={}){
  const origin=request.headers.get('origin');
  const configured=env.CORS_ALLOWED_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean);
  return !origin||!configured?.length||configured.includes(origin);
}
export function applyCors(request:Request,response:Response,env:{CORS_ALLOWED_ORIGINS?:string}={}){
  if(response.status===101)return response; // Preserve Durable Object WebSocket upgrades.
  const headers=new Headers(response.headers);
  if(!originAllowed(request,env))return new Response(null,{status:403,headers:{vary:'Origin'}});
  const origin=request.headers.get('origin');
  if(origin){headers.set('access-control-allow-origin',env.CORS_ALLOWED_ORIGINS?origin:'*');headers.append('vary','Origin');}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export function globalPreflightResponse(request?:Request,env:{CORS_ALLOWED_ORIGINS?:string}={}): Response {
  const origin=request?.headers.get('origin');
  const configured=env.CORS_ALLOWED_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean);
  const requested=(request?.headers.get('access-control-request-headers')??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
  const method=request?.headers.get('access-control-request-method');
  if((configured?.length&&origin&&!configured.includes(origin))||requested.some(x=>!CORS_ALLOWED_HEADERS.split(',').includes(x))||(method&&!['GET','POST','OPTIONS'].includes(method)))
    return new Response(null,{status:403,headers:{vary:'Origin, Access-Control-Request-Headers'}});
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": configured?.length&&origin?origin:'*',
      "vary":"Origin, Access-Control-Request-Headers",
      "access-control-allow-headers": CORS_ALLOWED_HEADERS,
      "access-control-allow-methods": "GET,POST,OPTIONS"
    }
  });
}

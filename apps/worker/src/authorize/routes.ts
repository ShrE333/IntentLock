import {sha256,randomApiKey,safeEqualText} from "./crypto";
import {
  createApiClient,
  findApiClientByHash,
  revokeApiClient
} from "./repository";
import {
  authorizeTransaction,
  verifyStoredAuthorization,
  type AuthorizeEnv
} from "./service";

type Env=AuthorizeEnv & {
  INTENTLOCK_ADMIN_KEY?:string;
};

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":
    "content-type,authorization,x-intentlock-key"
};

const json=(body:unknown,status=200)=>new Response(
  JSON.stringify(body),
  {status,headers}
);

function bearer(request:Request){
  const h=request.headers.get("authorization")??"";
  const m=h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim()
    || request.headers.get("x-intentlock-key")?.trim()
    || "";
}

async function requireClient(
  request:Request,
  env:Env,
  scope:string
){
  if(!env.DATABASE_URL)
    return {response:json({error:"DATABASE_NOT_CONFIGURED"},500)};

  const key=bearer(request);

  if(!key)
    return {response:json({error:"MISSING_API_KEY"},401)};

  const client=await findApiClientByHash(
    env.DATABASE_URL,
    await sha256(key)
  );

  if(!client)
    return {response:json({error:"INVALID_API_KEY"},401)};

  if(!client.scopes.includes(scope))
    return {response:json({error:"INSUFFICIENT_SCOPE",required:scope},403)};

  return {client};
}

function adminAuthorized(request:Request,env:Env){
  if(!env.INTENTLOCK_ADMIN_KEY) return false;
  const supplied=bearer(request);
  return Boolean(supplied) &&
    safeEqualText(supplied,env.INTENTLOCK_ADMIN_KEY);
}

export async function handleAuthorizeRoutes(
  request:Request,
  env:Env,
  url:URL
):Promise<Response|null>{
  if(
    request.method==="OPTIONS" &&
    url.pathname.startsWith("/v1/")
  ){
    return new Response(null,{status:204,headers});
  }

  if(url.pathname==="/v1/status" && request.method==="GET"){
    return json({
      service:"IntentLock Authorization API",
      version:"v1",
      configured:Boolean(
        env.DATABASE_URL &&
        env.INTENTLOCK_AUTH_SIGNING_SECRET
      ),
      decisions:["ALLOW","STEP_UP","BLOCK"],
      tokenType:"INTENTLOCK_AUTH_V1"
    });
  }

  if(url.pathname==="/v1/admin/clients" && request.method==="POST"){
    if(!adminAuthorized(request,env))
      return json({error:"ADMIN_UNAUTHORIZED"},401);

    if(!env.DATABASE_URL)
      return json({error:"DATABASE_NOT_CONFIGURED"},500);

    let body:any;
    try{ body=await request.json(); }
    catch{ return json({error:"INVALID_JSON"},400); }

    const name=String(body?.name??"").trim();
    if(!name) return json({error:"MISSING_NAME"},400);

    const allowedScopes=new Set(["authorize","verify"]);
    const scopes=Array.isArray(body?.scopes)
      ? body.scopes.map(String).filter((x:string)=>allowedScopes.has(x))
      : ["authorize","verify"];

    if(!scopes.length)
      return json({error:"NO_VALID_SCOPES"},400);

    const apiKey=randomApiKey();
    const clientId=`cli_${crypto.randomUUID()}`;

    const client=await createApiClient(
      env.DATABASE_URL,
      {
        clientId,
        name,
        apiKeyHash:await sha256(apiKey),
        keyPrefix:apiKey.slice(0,16),
        scopes
      }
    );

    return json({
      client,
      apiKey,
      warning:"This API key is returned once. Store it securely."
    },201);
  }

  const revoke=url.pathname.match(
    /^\/v1\/admin\/clients\/([^/]+)\/revoke$/
  );

  if(revoke && request.method==="POST"){
    if(!adminAuthorized(request,env))
      return json({error:"ADMIN_UNAUTHORIZED"},401);

    if(!env.DATABASE_URL)
      return json({error:"DATABASE_NOT_CONFIGURED"},500);

    const client=await revokeApiClient(
      env.DATABASE_URL,
      decodeURIComponent(revoke[1])
    );

    if(!client) return json({error:"CLIENT_NOT_FOUND"},404);
    return json({client});
  }

  if(url.pathname==="/v1/authorize" && request.method==="POST"){
    const auth=await requireClient(request,env,"authorize");
    if("response" in auth) return auth.response;

    let body:unknown;
    try{ body=await request.json(); }
    catch{ return json({error:"INVALID_JSON"},400); }

    try{
      const result=await authorizeTransaction(
        env,
        auth.client!,
        body
      );

      return json(result);
    }catch(error){
      const message=error instanceof Error
        ? error.message
        : String(error);

      const status=
        message==="WALLET_NOT_FOUND" ? 404 :
        message==="QUOTE_HASH_MISMATCH" ? 409 :
        message.startsWith("MISSING_") ||
        message.startsWith("INVALID_") ? 400 :
        500;

      return json({
        error:"AUTHORIZATION_FAILED",
        message
      },status);
    }
  }

  if(url.pathname==="/v1/verify" && request.method==="POST"){
    const auth=await requireClient(request,env,"verify");
    if("response" in auth) return auth.response;

    let body:any;
    try{ body=await request.json(); }
    catch{ return json({error:"INVALID_JSON"},400); }

    const token=String(body?.token??"").trim();
    if(!token) return json({error:"MISSING_TOKEN"},400);

    try{
      const result=await verifyStoredAuthorization(
        env,
        auth.client!,
        token
      );

      return json(result,result.valid?200:401);
    }catch(error){
      return json({
        error:"VERIFY_FAILED",
        message:error instanceof Error?error.message:String(error)
      },500);
    }
  }

  return null;
}

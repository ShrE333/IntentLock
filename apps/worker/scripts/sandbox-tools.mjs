import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, dirname} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {SafeSandboxError,safeDiagnostic} from './sandbox-diagnostics.mjs';
export {safeDiagnostic} from './sandbox-diagnostics.mjs';

export const workerRoot=fileURLToPath(new URL('../',import.meta.url));
export const demoConfig=resolve(workerRoot,'wrangler.demo.jsonc');
export const workerOrigin='https://intentlock-worker-demo.shdixit10.workers.dev';
export const requiredSecrets=['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_WEBHOOK_ID','PAYPAL_RETURN_BASE_URL','PAYPAL_ACCOUNT_MERCHANT_ID','PAYPAL_MERCHANT_BINDINGS_JSON'];

// Import the actual pure Worker validators in memory; no secret-bearing modules on disk.
export async function sourceModule(relative){
  async function compile(path,ancestors=[]){
    if(ancestors.includes(path))throw new Error('SOURCE_MODULE_CYCLE');
    const require=createRequire(pathToFileURL(path));
    let code=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    for(const match of [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]){
      const dependency=match[1].startsWith('.')
        ?await compile(resolve(dirname(path),match[1]+'.ts'),[...ancestors,path])
        :pathToFileURL(require.resolve(match[1])).href;
      code=code.replace(match[0],`from '${dependency}'`);
    }
    return 'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
  }
  try{return await import(await compile(resolve(workerRoot,relative)));}
  catch{throw new SafeSandboxError('SOURCE_MODULE_LOAD_FAILED');}
}

export function validateDemoConfig(config){
  if(config?.name!=='intentlock-worker-demo'||config.vars?.PAYPAL_ENV!=='sandbox'||config.env)
    throw new Error('DEMO_TARGET_OR_SANDBOX_INVALID');
  if(config.routes?.length||config.route||config.services?.length
    ||config.durable_objects?.bindings?.some(b=>b.script_name||b.environment))
    throw new Error('EXTERNAL_TARGET_BINDING_REJECTED');
  const producers=config.queues?.producers,consumers=config.queues?.consumers;
  if(producers?.length!==1||consumers?.length!==1||producers[0].binding!=='PURCHASE_QUEUE'
    ||producers[0].queue!=='intentlock-purchase-jobs-demo'||consumers[0].queue!==producers[0].queue
    ||consumers[0].max_batch_size!==1||!(consumers[0].max_retries>0)
    ||(consumers[0].dead_letter_queue&&!consumers[0].dead_letter_queue.endsWith('-demo')))
    throw new Error('DEMO_QUEUE_ISOLATION_INVALID');
  if([...requiredSecrets,'DATABASE_URL','APPROVAL_SIGNING_SECRET','INTENTLOCK_ADMIN_KEY','TRUSTOPS_ADMIN_TOKEN'].some(name=>Object.hasOwn(config.vars,name)))throw new Error('SECRETS_MUST_NOT_BE_IN_CONFIG');
  return {target:config.name,environment:'sandbox',queue:producers[0].queue,configurationOnly:true};
}
export async function checkConfig(){
  const parsed=ts.parseConfigFileTextToJson(demoConfig,await readFile(demoConfig,'utf8'));
  if(parsed.error)throw new Error('DEMO_CONFIG_PARSE_FAILED');
  return validateDemoConfig(parsed.config);
}
export function wrangler(args,{input,quiet=false}={}){
  const cli=resolve(workerRoot,'../../node_modules/wrangler/bin/wrangler.js');
  const result=spawnSync(process.execPath,[cli,...args,'--config',demoConfig],{
    cwd:workerRoot,input,encoding:'utf8',stdio:quiet?['pipe','pipe','pipe']:undefined,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.status!==0)throw new Error('WRANGLER_COMMAND_FAILED');
  return result.stdout;
}
export async function readJson(url,init={}){
  let response;
  try{response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch{throw new SafeSandboxError('NETWORK_OR_TLS_FAILURE');}
  if(!response.ok){
    let code='HTTP_ERROR';
    let providerStatus;
    try{const body=await response.json();code=safeDiagnostic(new Error(body?.code??body?.error)).code;
      if(Number.isInteger(body?.providerStatus)&&body.providerStatus>=100&&body.providerStatus<=599)providerStatus=body.providerStatus;}catch{}
    const failure=new SafeSandboxError(code==='UNEXPECTED_FAILURE'?'HTTP_ERROR':code,response.status);
    failure.providerStatus=providerStatus;throw failure;
  }
  try{return await response.json();}catch{throw new SafeSandboxError('INVALID_JSON_RESPONSE',response.status);}
}
export async function verifySandboxOAuth(env,fetcher=fetch){
  if(env.PAYPAL_ENV!=='sandbox')throw new SafeSandboxError('EXPLICIT_SANDBOX_REQUIRED');
  if(!env.PAYPAL_CLIENT_ID?.trim()||!env.PAYPAL_CLIENT_SECRET?.trim())throw new SafeSandboxError('PAYPAL_NOT_CONFIGURED');
  const {getPayPalAccessToken}=await sourceModule('src/session-payments/providers/paypal.ts');
  await getPayPalAccessToken(env,async(url,init)=>{
    try{return await fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch{throw new SafeSandboxError('OAUTH_TRANSPORT_FAILURE');}
  });
  return {oauthVerified:true,merchantVerified:false,paymentVerified:false,environment:'sandbox'};
}
export function matchingShas(a,b){return /^[a-f0-9]{40}$/i.test(a??'')&&/^[a-f0-9]{40}$/i.test(b??'')&&a.toLowerCase()===b.toLowerCase();}

async function main(){
  const command=process.argv[2]??'config';
  await checkConfig();
  if(command==='config')console.log(JSON.stringify(await checkConfig()));
  else if(command==='secrets'){
    const names=JSON.parse(wrangler(['secret','list'],{quiet:true})).map(s=>s.name);
    console.log(JSON.stringify({missing:requiredSecrets.filter(n=>!names.includes(n)),verification:'PRESENCE_ONLY'}));
  }else if(command==='put'){
    const name=process.argv[3];if(!requiredSecrets.includes(name))throw new Error('SECRET_NAME_INVALID');
    const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
    const value=Buffer.concat(chunks).toString('utf8').trim();
    if(!value)throw new Error('VALUE_REQUIRED');
    if(name==='PAYPAL_RETURN_BASE_URL'){
      const {paypalReturnBaseUrl}=await sourceModule('src/session-payments/providers/paypal.ts');
      paypalReturnBaseUrl({PAYPAL_ENV:'sandbox',PAYPAL_RETURN_BASE_URL:value});
    }
    if(name==='PAYPAL_ACCOUNT_MERCHANT_ID'&&!/^[2-9A-HJ-NP-Z]{13}$/.test(value))throw new Error('MERCHANT_ID_SHAPE_INVALID');
    if(name==='PAYPAL_MERCHANT_BINDINGS_JSON'){
      const {resolveRecipient,recipientMappingConfigured}=await sourceModule('src/payments/recipient-binding.ts');
      const rows=JSON.parse(value);if(!Array.isArray(rows)||!rows.length)throw new Error('MAPPING_REQUIRED');
      const merchant=process.env.INTENTLOCK_MAPPING_ACCOUNT_ID;
      if(!merchant)throw new Error('OPERATOR_ACCOUNT_ID_REQUIRED');
      if(!recipientMappingConfigured({PAYPAL_ENV:'sandbox',PAYPAL_ACCOUNT_MERCHANT_ID:merchant,PAYPAL_MERCHANT_BINDINGS_JSON:value}))throw new Error('DEMO_CATALOG_MAPPING_REQUIRED');
      for(const row of rows){
        if(row.environment!=='sandbox'||row.connectorId!=='paypal-demo-marketplace'||row.catalogProvider!=='paypal-demo')throw new Error('MAPPING_SCOPE_INVALID');
        const binding=await resolveRecipient({PAYPAL_ENV:'sandbox',PAYPAL_ACCOUNT_MERCHANT_ID:merchant,PAYPAL_MERCHANT_BINDINGS_JSON:value},row.connectorId,{source:{provider:row.catalogProvider,payeeId:row.catalogSellerId}});
        if(!binding)throw new Error('MAPPING_INVALID');
      }
    }
    wrangler(['secret','put',name],{input:value,quiet:true});console.log('Secret configured; validity not provider verified.');
  }else if(command==='readiness'){
    const [health,provider,web]=await Promise.all([readJson(workerOrigin+'/health'),readJson(workerOrigin+'/api/payments/provider'),readJson('https://intentlock-web.vercel.app/api/build-info')]);
    console.log(JSON.stringify({target:'intentlock-worker-demo',environment:provider.paypalEnvironment,readiness:provider.paypalReadiness,workerSha:health.gitCommit,frontendSha:web.gitCommit,commitMatch:matchingShas(health.gitCommit,web.gitCommit),verification:'CONFIGURATION_ONLY'},null,2));
    if(!provider.paypalReadiness?.ready||provider.paypalEnvironment!=='sandbox')process.exitCode=2;
  }else if(command==='oauth'){
    // Explicit, read-only sandbox request. OAuth cannot attest merchant authorization.
    console.log(JSON.stringify(await verifySandboxOAuth(process.env)));
  }else if(command==='dry-run'){
    const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:workerRoot,encoding:'utf8'}).trim();
    // Dry-run explicitly identifies its source, including dirty state. Never deploys.
    const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:workerRoot,encoding:'utf8'}).trim().length>0;
    console.log(JSON.stringify({sourceCommit:sha,dirty,deployable:!dirty}));
    const output=wrangler(['deploy','--dry-run','--outdir','.wrangler/demo-dry-run','--var',`BUILD_GIT_SHA:${sha}`,'--var','BUILD_ENVIRONMENT:preview']);
    console.log(output);
  }else if(command==='release-args'){
    const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:workerRoot,encoding:'utf8'}).trim();
    if(dirty)throw new Error('COMMIT_TRACKED_CHANGES_BEFORE_RELEASE');
    const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:workerRoot,encoding:'utf8'}).trim();
    console.log(`Operator only; inspect commit and untracked source dependencies first. No deploy executed.\nwrangler deploy --config wrangler.demo.jsonc --var BUILD_GIT_SHA:${sha} --var BUILD_ENVIRONMENT:preview`);
  }else throw new Error('UNKNOWN_COMMAND');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify(safeDiagnostic(error,process.argv[2]??'config')));process.exitCode=1;});

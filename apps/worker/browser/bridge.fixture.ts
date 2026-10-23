// Test-only loopback bridge. Never imports deployed environment files.
import {it,vi} from 'vitest';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const db=new PGlite({extensions:{pgcrypto}});
vi.mock('agents',()=>({routeAgentRequest:vi.fn().mockResolvedValue(null)}));
vi.mock('../src/agent/purchase-agent',()=>({PurchaseAgent:class {}}));
vi.mock('@neondatabase/serverless',()=>({neon:()=>{
 const sql=async(parts:TemplateStringsArray,...values:unknown[])=>{let query=parts[0];for(let i=0;i<values.length;i++)query+='$'+(i+1)+parts[i+1];return (await db.query(query,values)).rows;};
 sql.query=async(query:string,values:unknown[])=>(await db.query(query,values)).rows;return sql;
}}));
import worker from '../src/index';
import {catalogEnv,catalogFixture} from '../src/tests/shopify-mcp-fixture';
import {SHOPIFY_CATALOG_ENDPOINT} from '../src/commerce/shopify-mcp';
it('serves isolated browser policy and ownership handlers',async()=>{
 const files:string[]=JSON.parse(readFileSync(new URL('../db/release-order.json',import.meta.url),'utf8'));
 for(const file of files)await db.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input)!==SHOPIFY_CATALOG_ENDPOINT)throw new Error('BROWSER_BRIDGE_EXTERNAL_NETWORK_FORBIDDEN');
  const rpc=JSON.parse(String(init?.body)),fixture=catalogFixture();if(rpc.params.name==='lookup_catalog')fixture.products[0].variants[0].price.amount=6900;
  return Response.json({jsonrpc:'2.0',id:rpc.id,result:{structuredContent:fixture}});
 });
 const env={...catalogEnv,NATURAL_LANGUAGE_WALLETS_ENABLED:'true',DATABASE_URL:'isolated',DEMO_ACCESS_ENABLED:'true',PAYPAL_ENV:'sandbox',FX_PROVIDER:'static',APPROVAL_SIGNING_SECRET:'isolated-browser-signing-secret-only',CORS_ALLOWED_ORIGINS:'http://127.0.0.1:18748'};
 let stop=()=>{};const stopped=new Promise<void>(resolve=>{stop=resolve;});
 const server=createServer(async(req,res)=>{
  try{
   // Test fixture control, absent from production Worker routes.
   if(req.url==='/__test/stop'&&req.method==='POST'){res.writeHead(204);res.end();setTimeout(stop,0);return;}
   if(req.url==='/__test/reset'&&req.method==='POST'){
    await db.exec('TRUNCATE intent_wallets CASCADE; TRUNCATE financial_resource_owners,financial_demo_capabilities,financial_access_rate_limits,financial_access_nonces');
    res.writeHead(204);res.end();return;
   }
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
   // Each isolated browser principal gets its own conservative local test IP bucket.
   headers.set('cf-connecting-ip',headers.get('authorization')??'browser-issuance');
   const body=Buffer.concat(chunks).toString('utf8');
   const response=await worker.fetch(new Request('http://127.0.0.1:18747'+req.url,{method:req.method,headers,...(body?{body}:{})}),env as unknown as Env);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(500);res.end(JSON.stringify({error:'ISOLATED_BRIDGE_ERROR'}));}
 });
 await new Promise<void>(resolve=>server.listen(18747,'127.0.0.1',resolve));
 console.log('ISOLATED_BROWSER_BRIDGE_READY');
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 await stopped;
 await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();
});

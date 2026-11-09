import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {accessRule} from '../access/gate';

const read=(rel:string)=>readFileSync(new URL(rel,import.meta.url),'utf8');
const specText=read('../../../../docs/api/openapi.json');
const postmanText=read('../../../../docs/api/intentlock.postman_collection.json');
const spec:any=JSON.parse(specText);
const METHODS=['get','post','put','patch','delete'];
const operations=Object.entries<any>(spec.paths).flatMap(([path,item])=>METHODS.filter(m=>item[m]).map(m=>({path,method:m.toUpperCase(),op:item[m]})));
const gateSrc=read('../access/gate.ts');
const authorizeSrc=read('../authorize/routes.ts');

describe('OpenAPI contract',()=>{
 it('is OpenAPI 3.1 with info, servers and paths',()=>{
  expect(spec.openapi).toMatch(/^3\.1\./);
  expect(spec.info.title).toBeTruthy();
  expect(spec.info.version).toBeTruthy();
  expect(spec.servers.length).toBeGreaterThan(0);
  expect(Object.keys(spec.paths).length).toBeGreaterThan(10);
  expect(Object.keys(spec.components.securitySchemes)).toEqual(expect.arrayContaining(['bearerAuth','opsToken']));
 });
 it('gives every operation an unique operationId, tags and responses',()=>{
  const ids=operations.map(o=>o.op.operationId);
  expect(ids.every(Boolean)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  const declared=new Set(spec.tags.map((t:any)=>t.name));
  for(const {path,method,op} of operations){
   expect(op.tags?.length,`${method} ${path} tags`).toBeGreaterThan(0);
   for(const t of op.tags)expect(declared.has(t),`${method} ${path} tag ${t}`).toBe(true);
   expect(Object.keys(op.responses??{}).length,`${method} ${path} responses`).toBeGreaterThan(0);
  }
 });
 it('resolves every $ref',()=>{
  const refs:string[]=[];
  const walk=(v:any)=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){if(k==='$ref'&&typeof x==='string')refs.push(x);else walk(x);}}};
  walk(spec);
  expect(refs.length).toBeGreaterThan(0);
  for(const r of refs){
   expect(r.startsWith('#/'),r).toBe(true);
   let cur:any=spec;
   for(const part of r.slice(2).split('/'))cur=cur?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];
   expect(cur,`unresolved ${r}`).toBeDefined();
  }
 });
 it('models the decision and status enums',()=>{
  expect(spec.components.schemas.Decision.enum).toEqual(['ALLOW','STEP_UP','BLOCK']);
  expect(spec.components.schemas.SessionStatus.enum).toContain('CAPTURED');
 });
 it('only documents routes the worker actually serves',()=>{
  const sample=(p:string)=>p.replace(/\{[^}]+\}/g,'x');
  for(const {path,method,op} of operations){
   if((op.security??[]).some((s:any)=>'opsToken' in s))continue;
   const p=sample(path);
   if(p.startsWith('/v1/')){expect(authorizeSrc,`${method} ${path}`).toContain(`"${p}"`);continue;}
   if(p.startsWith('/api/access/')){expect(gateSrc,path).toContain(`'${p}'`);continue;}
   if(method==='GET'&&['/health','/api/payments/provider','/api/payments/capabilities','/api/commerce/connectors'].includes(p)){
    // Public GET routes are listed in the gate's publicPaths set (or /health).
    expect(gateSrc,`${method} ${path}`).toContain(`'${p}'`);continue;
   }
   const rule=accessRule(p,method);
   expect(rule,`${method} ${path} not recognised by accessRule`).not.toBeNull();
   expect(rule?.ops??false,`${method} ${path} is operator-only`).toBe(false);
  }
 });
 it('documents the demo nonce header with the gate format',()=>{
  const pattern=spec.components.parameters.RequestId.schema.pattern;
  expect(gateSrc).toContain('/^[-a-zA-Z0-9_]{16,128}$/');
  expect(pattern).toBe('^[-a-zA-Z0-9_]{16,128}$');
 });
});

describe('Postman collection',()=>{
 const c:any=JSON.parse(postmanText);
 it('is a v2.1 collection with the happy path',()=>{
  expect(c.info.schema).toBe('https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  expect(c.item.length).toBeGreaterThanOrEqual(6);
  const keys=c.variable.map((v:any)=>v.key);
  expect(keys).toEqual(expect.arrayContaining(['baseUrl','token','walletId','sessionId']));
 });
 it('contains no token-like strings',()=>{
  expect(postmanText).not.toMatch(/ildemo_[a-f0-9]{64}/);
  expect(postmanText).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  expect(specText).not.toMatch(/ildemo_[a-f0-9]{64}/);
  expect(specText).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
 });
});

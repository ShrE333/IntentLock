import {describe,it,expect,vi} from 'vitest';
import {createDemoTransport} from '../../../web/app/demo-access';
const token='ildemo_'+'a'.repeat(64),rotated='ildemo_'+'b'.repeat(64);
function setup(){const data=new Map<string,string>();const storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};return {storage,data};}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
describe('anonymous browser demo capability transport',()=>{
 it('bootstraps once for concurrent requests and sends a fresh mutation nonce',async()=>{
   const {storage}=setup();const fetcher=vi.fn().mockResolvedValueOnce(json({token,expiresAt:new Date(Date.now()+1800000).toISOString()},201)).mockImplementation(async()=>json({wallets:[]}));
   const client=createDemoTransport('https://worker.test',storage,fetcher);
   await Promise.all([client.fetch('/api/wallets'),client.fetch('/api/sessions')]);
   expect(fetcher.mock.calls.filter(c=>String(c[0]).endsWith('/api/access/demo'))).toHaveLength(1);
   await client.fetch('/api/sessions',{method:'POST',body:'{}'});await client.fetch('/api/sessions',{method:'POST',body:'{}'});
   const calls=fetcher.mock.calls.slice(-2);const headers=calls.map(c=>new Headers(c[1].headers));
   expect(headers[0].get('authorization')).toBe('Bearer '+token);expect(headers[0].get('x-intentlock-request-id')).not.toBe(headers[1].get('x-intentlock-request-id'));
 });
 it('rotates before expiry without sending credentials in URLs',async()=>{
   const {storage}=setup();storage.setItem('intentlock:demo-access:v1',JSON.stringify({token,expiresAt:new Date(Date.now()+60000).toISOString()}));
   const fetcher=vi.fn().mockResolvedValueOnce(json({token:rotated,expiresAt:new Date(Date.now()+1800000).toISOString()})).mockResolvedValueOnce(json({}));
   await createDemoTransport('https://worker.test',storage,fetcher).fetch('/api/wallets');
   expect(String(fetcher.mock.calls[0][0])).toBe('https://worker.test/api/access/refresh');
   expect(new Headers(fetcher.mock.calls[1][1].headers).get('authorization')).toBe('Bearer '+rotated);
   expect(fetcher.mock.calls.every(c=>!String(c[0]).includes('ildemo_'))).toBe(true);
 });
 it('fails closed for expired access instead of claiming historical resources',async()=>{
   const {storage}=setup();storage.setItem('intentlock:demo-access:v1',JSON.stringify({token,expiresAt:'2000-01-01T00:00:00Z'}));const fetcher=vi.fn();
   await expect(createDemoTransport('https://worker.test',storage,fetcher).fetch('/api/sessions/old')).rejects.toThrow('expired');expect(fetcher).not.toHaveBeenCalled();
 });
 it('isolates browser storage instances and never forwards credentials to another origin',async()=>{
   const fetcher=vi.fn();const client=createDemoTransport('https://worker.test',setup().storage,fetcher);
   await expect(client.fetch('https://evil.test/collect')).rejects.toThrow('another origin');expect(fetcher).not.toHaveBeenCalled();
   await expect(client.fetch('/api/wallets',{headers:{'x-intentlock-ops-token':'forged'}})).rejects.toThrow('server-side');
 });
 it('does not require signup or bootstrap for public service status',async()=>{
   const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({configured:false}));await createDemoTransport('https://worker.test',setup().storage,fetcher).fetch('/api/payments/provider');
   expect(fetcher).toHaveBeenCalledOnce();expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
 });
 it('revokes before clearing a visitor capability',async()=>{
   const {storage,data}=setup();storage.setItem('intentlock:demo-access:v1',JSON.stringify({token,expiresAt:new Date(Date.now()+1800000).toISOString()}));const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({ok:true}));
   await createDemoTransport('https://worker.test',storage,fetcher).reset();expect(String(fetcher.mock.calls[0][0])).toContain('/api/access/logout');expect(data.size).toBe(0);
 });
});

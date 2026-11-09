import {beforeEach,describe,it,expect,vi} from 'vitest';
import {secureFinancialRequest,demoLimit,demoRateLimits} from '../access/gate';
import {ACCESS_CONTEXT,sha256} from '../access/identity';
import * as repo from '../access/repository';
vi.mock('../access/repository',()=>({rateLimit:vi.fn(),capabilityByHash:vi.fn(),createCapability:vi.fn(),rotateCapability:vi.fn(),revokeCapability:vi.fn(),claimNonce:vi.fn(),hasWalletPermission:vi.fn(),ownsIntent:vi.fn(),resourceWallet:vi.fn(),isDemoSession:vi.fn()}));
vi.mock('../authorize/repository',()=>({findApiClientByHash:vi.fn()}));
const base={DATABASE_URL:'postgres://isolated.invalid/db',DEMO_ACCESS_ENABLED:'true',PAYPAL_ENV:'sandbox'};
const token='ildemo_'+'a'.repeat(64);
const next=vi.fn(async(_r:Request,e:any)=>new Response(JSON.stringify({p:e[ACCESS_CONTEXT]?.principalId}),{status:201}));
let limits:Map<string,number>;
beforeEach(async()=>{
 vi.resetAllMocks();limits=new Map();
 vi.mocked(repo.rateLimit).mockImplementation(async(_db,key,max)=>{limits.set(key,max as number);return true;});
 const hash=await sha256(token);
 vi.mocked(repo.capabilityByHash).mockImplementation(async(_d,h)=>h===hash?{principal_id:'demo:a',expires_at:new Date(Date.now()+600000).toISOString()} as any:null);
 vi.mocked(repo.claimNonce).mockResolvedValue(true);
 vi.mocked(repo.createCapability).mockResolvedValue(undefined as any);
 vi.mocked(repo.hasWalletPermission).mockResolvedValue(true);
 next.mockImplementation(async(_r,e:any)=>new Response('{}',{status:201}));
});
const issue=(env:any)=>secureFinancialRequest(new Request('https://w.test/api/access/demo',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1','content-type':'application/json'},body:'{}'}),env,next);
const wallet=(env:any)=>secureFinancialRequest(new Request('https://w.test/api/wallets',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.1',authorization:'Bearer '+token,'content-type':'application/json','x-intentlock-request-id':crypto.randomUUID()},body:JSON.stringify({name:'t',currency:'USD',totalAuthority:50,maxSingleTransaction:50,validUntil:new Date(Date.now()+3600000).toISOString()})}),env,next);
const max=(prefix:string)=>[...limits].find(([k])=>k.startsWith(prefix))?.[1];
describe('demoLimit parsing',()=>{
 it('accepts integers in range',()=>{expect(demoLimit('1',3)).toBe(1);expect(demoLimit('1000',3)).toBe(1000);expect(demoLimit(' 50 ',3)).toBe(50);expect(demoLimit('10000',200,10000)).toBe(10000);});
 it.each([undefined,null,'','abc','0','-1','1001','1.5','1e3','0x10','NaN','Infinity','99999999999',' ',5,{}])('falls back to default for %j',v=>{expect(demoLimit(v,3)).toBe(3);});
 it('global limit caps at 10000',()=>{expect(demoLimit('10001',200,10000)).toBe(200);});
 it('defaults match previous hard-coded values',()=>{expect(demoRateLimits(base)).toEqual({issuePerIp:3,issueGlobal:200,walletsPerPrincipal:2,walletsPerIp:6});});
 it('applies overrides and ignores invalid ones independently',()=>{
  expect(demoRateLimits({...base,DEMO_ISSUE_PER_IP_PER_HOUR:'60',DEMO_ISSUE_GLOBAL_PER_HOUR:'5000',DEMO_WALLETS_PER_PRINCIPAL_PER_HOUR:'0',DEMO_WALLETS_PER_IP_PER_HOUR:'x'})).toEqual({issuePerIp:60,issueGlobal:5000,walletsPerPrincipal:2,walletsPerIp:6});
 });
});
describe('gate uses configured limits',()=>{
 it('issuance defaults',async()=>{expect((await issue(base)).status).toBe(201);expect(max('issue:global')).toBe(200);expect([...limits].find(([k])=>k.startsWith('issue:')&&k!=='issue:global')?.[1]).toBe(3);});
 it('issuance overrides',async()=>{await issue({...base,DEMO_ISSUE_PER_IP_PER_HOUR:'40',DEMO_ISSUE_GLOBAL_PER_HOUR:'900'});expect(max('issue:global')).toBe(900);expect([...limits].find(([k])=>k.startsWith('issue:')&&k!=='issue:global')?.[1]).toBe(40);});
 it('issuance invalid falls back',async()=>{await issue({...base,DEMO_ISSUE_PER_IP_PER_HOUR:'-5',DEMO_ISSUE_GLOBAL_PER_HOUR:'lots'});expect(max('issue:global')).toBe(200);expect([...limits].find(([k])=>k.startsWith('issue:')&&k!=='issue:global')?.[1]).toBe(3);});
 it('still returns 429 when the store refuses',async()=>{vi.mocked(repo.rateLimit).mockResolvedValue(false);const r=await issue(base);expect(r.status).toBe(429);});
 it('wallet defaults',async()=>{await wallet(base);expect(max('wallet:')).toBe(2);expect(max('wallet-ip:')).toBe(6);});
 it('wallet overrides',async()=>{await wallet({...base,DEMO_WALLETS_PER_PRINCIPAL_PER_HOUR:'10',DEMO_WALLETS_PER_IP_PER_HOUR:'100'});expect(max('wallet:')).toBe(10);expect(max('wallet-ip:')).toBe(100);});
 it('wallet invalid falls back',async()=>{await wallet({...base,DEMO_WALLETS_PER_PRINCIPAL_PER_HOUR:'5000',DEMO_WALLETS_PER_IP_PER_HOUR:''});expect(max('wallet:')).toBe(2);expect(max('wallet-ip:')).toBe(6);});
});

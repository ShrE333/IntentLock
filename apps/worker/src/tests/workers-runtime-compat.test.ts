import {describe,it,expect,vi} from 'vitest';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getPayPalAccessToken} from '../session-payments/providers/paypal';

// Mocked fetch accepts any RequestInit, so runtime-only rejections never surface in
// unit tests. Cloudflare Workers throws on redirect:'error' (only 'follow' and
// 'manual' exist), which made every deployed PayPal OAuth call fail as
// OAUTH_TRANSPORT_FAILURE while Node-based checks passed.
const src=fileURLToPath(new URL('..',import.meta.url));
function sources(dir:string):string[]{
 return readdirSync(dir).flatMap(name=>{
  const path=join(dir,name);
  if(statSync(path).isDirectory())return name==='tests'?[]:sources(path);
  return path.endsWith('.ts')?[path]:[];
 });
}
const env={PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_ID:'isolated-client',PAYPAL_CLIENT_SECRET:'isolated-secret'};

describe('Cloudflare Workers runtime compatibility',()=>{
 it('worker source never uses fetch redirect modes the Workers runtime rejects',()=>{
  const offenders=sources(src).filter(file=>/redirect\s*:\s*['"]error['"]/.test(readFileSync(file,'utf8')));
  expect(offenders).toEqual([]);
 });
 it('PayPal OAuth does not follow redirects and refuses a 3xx response',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'https://elsewhere.invalid/'}}));
  await expect(getPayPalAccessToken(env,fetcher)).rejects.toThrow('PAYPAL_OAUTH_302:TOKEN_REQUEST_FAILED');
  expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
 });
});

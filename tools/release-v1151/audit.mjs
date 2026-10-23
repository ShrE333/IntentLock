#!/usr/bin/env node
/**
 * IntentLock V11.5.1 read-only release auditor.
 * No payments, financial mutations, deployments, secrets or migrations.
 * Usage: node tools/release-v1151/audit.mjs [--web https://...] [--api https://...]
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (['--web', '--api'].includes(key) && args[i+1]) options[key.slice(2)] = args[++i];
  else if (key === '--help') {
    console.log('Usage: node tools/release-v1151/audit.mjs [--web https://your.vercel.app] [--api https://your.worker.workers.dev]');
    process.exit(0);
  } else { console.error(`Unknown or incomplete argument: ${key}`); process.exit(2); }
}
let failed = 0, warnings = 0, passed = 0;
function report(severity, area, details) {
  if (severity === 'FAIL') failed++;
  else if (severity === 'WARN') warnings++;
  else passed++;
  console.log(`${severity.padEnd(4)}  ${area}: ${details}`);
}
function file(rel) { return existsSync(join(root, rel)); }
function git(...arg) {
  const p = spawnSync('git', arg, {cwd:root, encoding:'utf8', timeout:12000});
  if (p.status !== 0) return null;
  return (p.stdout || '').trim();
}
function read(rel) { try { return readFileSync(join(root,rel),'utf8'); } catch {return '';} }
const mustExist = [
  'package.json', 'apps/web/package.json', 'apps/web/app/page.tsx',
  'apps/web/app/layout.tsx', 'apps/web/app/new-purchase/page.tsx',
  'apps/web/app/commerce/page.tsx', 'apps/web/app/wallets/page.tsx',
  'apps/web/app/trust-center/page.tsx', 'apps/web/app/post-purchase/page.tsx',
  'apps/worker/package.json', 'apps/worker/src/index.ts',
  'docs/V11.4.3-security-state-integrity.md',
  'docs/V11.4.4-financial-access-control.md',
  'docs/V11.4.5-atomic-wallet-reservations.md',
  'docs/V11.4.6-verified-payee-binding.md',
  'docs/V11.4.7-integration-release-readiness.md',
  'docs/V11.4.8-sandbox-readiness.md',
  'docs/V11.4.9-shopify-live-discovery.md',
  'docs/V11.5-natural-language-authority.md',
  'apps/worker/db/v11_4_4_financial_access.sql',
  'apps/worker/db/v11_4_5_wallet_reservations.sql',
  'apps/worker/db/v11_4_6_verified_recipient.sql',
];
console.log('IntentLock V11.5.1 release audit (read-only)');
console.log(`Repository: ${root}\n`);
for(const f of mustExist) report(file(f)?'PASS':'FAIL','Repository',f);
const branch=git('branch','--show-current');
const sha=git('rev-parse','HEAD');
report(branch ? 'PASS':'FAIL','Git branch',branch??'unavailable');
report(sha ? 'PASS':'FAIL','Git HEAD',sha??'unavailable');
const status=git('status','--porcelain');
if(status===null) report('FAIL','Git status','unavailable');
else if(status) report('WARN','Git working tree','uncommitted/untracked files present; compare tested code and staged code before releasing');
else report('PASS','Git working tree','clean');
const remotes=git('remote','-v') ?? '';
report(remotes.includes('ShrE333/IntentLock')?'PASS':'WARN','Git origin',remotes.includes('ShrE333/IntentLock')?'expected repository':'origin is not confirmed as ShrE333/IntentLock');
const staged=(git('diff','--cached','--name-only')??'').split(/\r?\n/).filter(Boolean);
const sensitive=staged.filter(name=> /(^|\/)(\.env(\.|$)|\.dev\.vars(\.|$)|\.vercel(\/|$)|\.next(\/|$)|node_modules(\/|$)|.*\.(pem|p12|key)$)/i.test(name) && !/\.example$/i.test(name));
if(sensitive.length) report('FAIL','Secret/staging hygiene',`${sensitive.length} unsafe-looking staged path(s): ${sensitive.join(', ')}`);
else report('PASS','Secret/staging hygiene','no obvious secret/build paths staged (content still requires human review)');
report(file('apps/web/app/api/build-info/route.ts')?'PASS':'WARN','Deployment identity','/api/build-info route exists (or kit not applied yet)');
const ci = read('.github/workflows/ci.yml');
report(ci.includes('playwright') && ci.includes('tsc')?'PASS':'WARN','CI','browser and TypeScript jobs present');
const runtime=read('apps/web/app/runtime-config.ts')+read('apps/web/app/lib.ts');
report(runtime.includes('NEXT_PUBLIC_INTENTLOCK_API_URL')?'PASS':'WARN','Frontend API configuration','production API URL configuration referenced');
const oldHomepage=read('apps/web/app/page.tsx');
report(/END-TO-END CAPTURE VERIFIED|PAYMENT SUCCESSFUL FOR ALL/i.test(oldHomepage)?'WARN':'PASS','Claims review','automatic scan complete; manually review UI evidence labels');
report('WARN','WAHA','intentionally skipped; service is offline by design and should not gate web/Worker review');
if (!file('apps/web/app/api/build-info/route.ts')) report('WARN','Deployment comparison','apply additive build-info route to compare live deployment SHA');

function parseHttps(label, value) {
  if (!value) return null;
  try {
    const u=new URL(value);
    if(u.protocol!=='https:') throw new Error('must use HTTPS');
    if(u.username||u.password) throw new Error('URL may not carry credentials');
    return u;
  } catch(e) {report('FAIL',label, `Invalid URL: ${e.message}`);return null;}
}
async function fetchReadOnly(url){
  const r=await fetch(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(9000),headers:{'Accept':'application/json, text/html;q=0.9'}});
  return r;
}
const web=parseHttps('Web URL',options.web);
if(web){
  const home=new URL('/',web);
  try {
    const r=await fetchReadOnly(home);
    report(r.ok?'PASS':'WARN','Live web homepage',`${r.status} ${home}`);
  } catch(e){report('WARN','Live web homepage',e.message)}
  const buildInfo=new URL('/api/build-info',web);
  try {
    const r=await fetchReadOnly(buildInfo);
    if(!r.ok) report('WARN','Live deployment identity',`${r.status}; route absent, inaccessible or wrong deployment`);
    else {
      const j=await r.json();
      if(j?.service!=='intentlock-web') report('WARN','Live deployment identity','response does not identify IntentLock');
      else if(!j.gitCommit) report('WARN','Live deployment identity','endpoint exists but Vercel Git SHA is unavailable; inspect project deployment settings');
      else if (sha && j.gitCommit===sha) report('PASS','Live deployment identity',`matches local HEAD (${sha.slice(0,12)})`);
      else report('WARN','Live deployment identity',`deployed=${String(j.gitCommit).slice(0,12)} local=${sha?.slice(0,12)??'unknown'}; check intended branch/PR`);
    }
  } catch(e){report('WARN','Live deployment identity',e.message)}
} else report('WARN','Live site','--web not specified; live Vercel page not checked');
const api=parseHttps('Worker URL',options.api);
if(api){
  const health = new URL('/health', api);
  try {const r=await fetchReadOnly(health);report(r.ok?'PASS':'WARN','Worker health',`${r.status} ${health}`);}
  catch(e){report('WARN','Worker health',e.message)}
} else report('WARN','Worker health','--api not specified; Worker not checked');
console.log(`\nSummary: ${passed} pass; ${warnings} warning; ${failed} fail`);
console.log('Notes: code-file presence is not runtime validation; production payments require their own rollout gates.');
process.exitCode=failed?1:0;

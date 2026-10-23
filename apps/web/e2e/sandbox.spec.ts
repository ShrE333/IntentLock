import {test,expect,type Page} from '@playwright/test';
const api='http://127.0.0.1:18747';
test.beforeEach(async({context,request})=>{
 expect((await request.post(api+'/__test/reset')).status()).toBe(204);
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());return ['http://127.0.0.1:18748',api].includes(url.origin)?route.continue():route.abort();
 });
});
async function scenarioWallet(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Create $100 scenario wallet'}).click();
 await expect(page.getByLabel('Active USD wallet')).toBeVisible();
}
async function apiCall(page:Page,path:string,body?:object){
 return page.evaluate(async({api,path,body})=>{
  const saved=JSON.parse(sessionStorage.getItem('intentlock:demo-access:v1')!);
  const response=await fetch(api+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+saved.token,...(body?{'content-type':'application/json','x-intentlock-request-id':crypto.randomUUID()}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 },{api,path,body});
}
test('all frontend routes render and fit the viewport',async({page})=>{
 test.setTimeout(120000); // Thirteen cold Next.js route compilations in one check.
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const path of ['/','/wallets','/commerce','/new-purchase','/trust-center','/post-purchase','/trust','/security-lab','/evals','/audit','/how-it-works','/demo','/proof/not-owned']){
  const response=await page.goto(path);expect(response?.status()).toBe(200);await expect(page.locator('h1').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),path).toBe(true);
 }
 expect(errors).toEqual([]);
});
test('new visitor creates a wallet, searches commerce, sees actual policy and unearned evidence stays unverified',async({page})=>{
 await scenarioWallet(page);await page.goto('/commerce');
 await page.getByLabel('Search',{exact:true}).fill('Sony WH-CH720N wireless ANC headphones');
 await page.getByRole('button',{name:'Search Marketplace'}).click();await expect(page.getByText('Sony WH-CH720N Wireless ANC Headphones',{exact:true}).first()).toBeVisible();
 const wallets=await apiCall(page,'/api/wallets');const walletId=wallets.body.wallets[0].walletId;
 expect(walletId).toBeTruthy();await page.goto('/');await page.getByRole('button',{name:'Run real policy evaluation'}).click();
 await expect(page.getByText('ALLOW',{exact:true}).last()).toBeVisible();
 await page.getByRole('link',{name:'Continue real transaction'}).click();await expect(page.getByText('READY TO PAY',{exact:true}).first()).toBeVisible();
 await expect(page).toHaveURL(/\/new-purchase\?sessionId=/);const id=new URL(page.url()).searchParams.get('sessionId')!;
 await page.goto('/proof/'+id);await expect(page.getByText('PROOF_NOT_READY',{exact:false}).first()).toBeVisible();
 expect((await apiCall(page,`/api/sessions/${id}/proof`)).status).toBe(404);
});
test('Bose step-up resolves once and Boat remains blocked',async({page})=>{
 await scenarioWallet(page);
 for(const [brand,decision]of [['Bose','STEP_UP'],['Boat','BLOCK']]){
  await page.goto('/');await page.getByRole('button',{name:brand==='Bose'?/Bose QuietComfort/:/Boat Nirvana/}).click();
  await page.getByRole('button',{name:'Run real policy evaluation'}).click();
  await expect(page.getByLabel('Policy decision: '+decision.replace('_',' ')).last()).toBeVisible();
  await page.getByRole('link',{name:'Continue real transaction'}).click();await expect(page.getByText(decision==='STEP_UP'?'Step-Up Approval':'BLOCKED',{exact:true}).first()).toBeVisible();
  if(brand==='Bose'){
   await page.getByRole('button',{name:/Allow once/i}).click();await expect(page.getByText('READY TO PAY',{exact:true}).first()).toBeVisible();
  }
 }
});
test('separate anonymous browser storage cannot access another visitors wallet or session',async({page,browser})=>{
 await scenarioWallet(page);const walletId=(await apiCall(page,'/api/wallets')).body.wallets[0].walletId;
 const id=(await apiCall(page,'/api/sessions',{walletId,connectorId:'paypal-demo-marketplace',prompt:'Sony',channel:'WEB'})).body.session.sessionId;
 const other=await browser.newContext();const b=await other.newPage();await b.goto('/wallets');
 await expect(b.getByText('No Intent Wallet yet.')).toBeVisible();await expect.poll(async()=>b.evaluate(()=>!!sessionStorage.getItem('intentlock:demo-access:v1'))).toBe(true);
 expect((await apiCall(b,`/api/sessions/${id}`)).status).toBe(404);
 expect((await apiCall(b,'/api/sessions',{walletId,connectorId:'paypal-demo-marketplace',prompt:'forged',ownerId:'demo:forged'})).status).toBe(404);
 expect((await apiCall(b,'/api/wallets')).body.wallets).toEqual([]);await other.close();
});
test('unavailable payment service and disconnected API show errors without verified claims',async({page})=>{
 await page.goto('/');await expect(page.getByText('PayPal sandbox payment services are unavailable or not configured in this deployment.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Run real policy evaluation'})).toBeDisabled();
 await page.route(api+'/**',route=>route.abort());await page.goto('/wallets');
 await expect(page.locator('.alertError')).toBeVisible();
});
test('wallet loading is distinct from an empty account and navigation works',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route(api+'/api/wallets',async route=>{await pending;await route.continue();});
 await page.goto('/wallets');await expect(page.getByRole('status')).toHaveText('Loading Intent Wallets...');
 release();await expect(page.getByText('No Intent Wallet yet.')).toBeVisible();
 await page.getByRole('navigation',{name:'Product navigation'}).getByRole('link',{name:'Architecture',exact:true}).click();
 await expect(page).toHaveURL(/\/how-it-works$/);
});
test('flagged Shopify catalog shows exact identity, price refresh and non-executable policy',async({page})=>{
 await scenarioWallet(page);await page.goto('/commerce');
 await page.getByLabel('Commerce Connector').selectOption('shopify-global-catalog');
 await page.getByRole('button',{name:'Search Marketplace'}).click();
 await expect(page.getByText('Exact price: 4900 USD minor units')).toBeVisible();
 await expect(page.getByText('Exact variant: gid://shopify/ProductVariant/123')).toBeVisible();
 await expect(page.getByText('Seller: gid://shopify/Shop/456 · merchant.myshopify.com')).toBeVisible();
 await expect(page.getByText('Condition (inferred): new')).toBeVisible();
 await expect(page.getByText('Live Shopify catalog discovery only.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Refresh exact variant'}).click();
 await expect(page.getByText('Exact price: 6900 USD minor units')).toBeVisible();
 expect((await apiCall(page,'/api/wallets')).body.wallets[0].spentAmount).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true);
});

test('natural-language wallet review edits, simulation and explicit confirmation preserve boundaries',async({page})=>{
 await page.goto('/wallets');
 const composer=page.getByRole('region',{name:'Describe your agent’s boundaries'});
 await composer.getByRole('button',{name:'Use example'}).click();
 await composer.getByRole('button',{name:'Compile draft'}).click();
 await expect(composer.getByRole('heading',{name:'Review before authorization'})).toBeVisible();
 await expect(composer.getByText('DRAFT / NOT AUTHORIZED',{exact:true})).toBeVisible();
 expect((await apiCall(page,'/api/wallets')).body.wallets).toHaveLength(0);
 await expect(composer.getByRole('button',{name:'Confirm and authorize wallet'})).toBeDisabled();
 await composer.getByLabel('Excluded conditions:',{exact:false}).fill('none');
 await expect(composer.getByRole('button',{name:'Confirm and authorize wallet'})).toHaveCount(0);
 await composer.getByRole('button',{name:'Validate and preview exact policy'}).click();
 await expect(composer.getByRole('heading',{name:'Review before authorization'})).toBeVisible();
 await composer.getByLabel('Sample amount').fill('60');
 await composer.getByLabel('Sample brand').fill('Sony');
 await composer.getByLabel('Sample category').fill('electronics');
 await composer.getByRole('button',{name:'Simulate policy'}).click();
 await expect(composer.getByText('STEP-UP',{exact:true})).toBeVisible();
 expect((await apiCall(page,'/api/wallets')).body.wallets).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2)).toBe(true);
 await page.screenshot({path:'.validation/wallet-authority-'+test.info().project.name+'.png',fullPage:true});
 await composer.getByRole('checkbox').check();
 await composer.getByRole('button',{name:'Confirm and authorize wallet'}).click();
 await expect(composer.getByText('Wallet confirmed.',{exact:false})).toBeVisible();
 const wallets=(await apiCall(page,'/api/wallets')).body.wallets;
 expect(wallets).toHaveLength(1);expect(wallets[0].autoBuyLimit).toBe(50);expect(wallets[0].maxSingleTransaction).toBe(75);
 expect((await apiCall(page,'/api/wallet-authority/history/'+wallets[0].walletId)).body.versions).toHaveLength(1);
});
test('incomplete natural language requests clarification and cannot silently authorize',async({page})=>{
 await page.goto('/wallets');const composer=page.getByRole('region',{name:'Describe your agent’s boundaries'});
 await composer.getByLabel('Your instructions').fill('Give my shopping agent 100 USD for one day. Allow Sony and Bose electronics. Auto limit 50 USD. No blocked brands. No required features. New only.');
 await composer.getByRole('button',{name:'Compile draft'}).click();
 await expect(composer.getByText('Please specify Hard transaction ceiling.',{exact:true})).toBeVisible();
 await expect(composer.getByRole('button',{name:'Confirm and authorize wallet'})).toHaveCount(0);
 await composer.getByRole('button',{name:'Validate and preview exact policy'}).click();
 await expect(composer.getByRole('alert')).toContainText('Please explicitly specify');
 expect((await apiCall(page,'/api/wallets')).body.wallets).toHaveLength(0);
});
test('compiler outage is recoverable and creates no authority',async({page})=>{
 await page.goto('/wallets');const composer=page.getByRole('region',{name:'Describe your agent’s boundaries'});
 await page.route('**/api/wallet-authority/compile',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"WALLET_AUTHORITY_UNAVAILABLE"}'}));
 await composer.getByRole('button',{name:'Use example'}).click();await composer.getByRole('button',{name:'Compile draft'}).click();
 await expect(composer.getByRole('alert')).toContainText('WALLET_AUTHORITY_UNAVAILABLE');
 await expect(composer.getByRole('button',{name:'Compile draft'})).toBeEnabled();
 await page.route('**/api/wallet-authority/compile',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await composer.getByRole('button',{name:'Compile draft'}).click();
 await expect(composer.getByRole('alert')).toContainText('incomplete compilation');
 await expect(composer.getByRole('button',{name:'Confirm and authorize wallet'})).toHaveCount(0);
});

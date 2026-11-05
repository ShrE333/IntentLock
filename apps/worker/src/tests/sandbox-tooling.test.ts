import {describe,it,expect} from 'vitest';
// @ts-expect-error Operator ESM tooling is executed directly by Node.
import {validateDemoConfig,matchingShas,sourceModule} from '../../scripts/sandbox-tools.mjs';
const config={name:'intentlock-worker-demo',vars:{PAYPAL_ENV:'sandbox'},queues:{producers:[{binding:'PURCHASE_QUEUE',queue:'intentlock-purchase-jobs-demo'}],consumers:[{queue:'intentlock-purchase-jobs-demo',max_batch_size:1,max_retries:5}]}};
describe('sandbox operator guards',()=>{
 it('accepts isolated sandbox config',()=>expect(validateDemoConfig(config).configurationOnly).toBe(true));
 it.each(['intentlock-worker','another-worker'])('rejects non-demo target %s',name=>expect(()=>validateDemoConfig({...config,name})).toThrow());
 it('rejects live, overrides, shared queues and inline secrets',()=>{
  for(const patch of [{vars:{PAYPAL_ENV:'live'}},{env:{production:{}}},{vars:{PAYPAL_ENV:'sandbox',PAYPAL_CLIENT_SECRET:'unit-only'}},{queues:{...config.queues,consumers:[{queue:'intentlock-purchase-jobs',max_batch_size:1,max_retries:5}]}}])expect(()=>validateDemoConfig({...config,...patch})).toThrow();
 });
 it('rejects production routes and remote Durable Object/service bindings',()=>{
  for(const patch of [{routes:['production.example/*']},{route:'production.example/*'},{services:[{binding:'OTHER',service:'intentlock-worker'}]},{durable_objects:{bindings:[{name:'PurchaseAgent',script_name:'intentlock-worker'}]}}])expect(()=>validateDemoConfig({...config,...patch})).toThrow('EXTERNAL_TARGET_BINDING_REJECTED');
 });
 it('compares only full non-null SHAs',()=>{
  expect(matchingShas(null,null)).toBe(false);expect(matchingShas('V11.5.1','V11.5.1')).toBe(false);
  expect(matchingShas('a'.repeat(40),'A'.repeat(40))).toBe(true);expect(matchingShas('a'.repeat(40),'b'.repeat(40))).toBe(false);
 });
 it('runs actual recipient validator without writing mapping values to disk',async()=>{
  const module=await sourceModule('src/payments/recipient-binding.ts');
  expect(module.recipientMappingConfigured({})).toBe(false);
 });
});

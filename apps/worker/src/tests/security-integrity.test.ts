import {describe,it,expect} from 'vitest';
import {evaluateWalletTransaction} from '../wallets/policy';
import {globalPreflightResponse} from '../http/cors';

const wallet={walletId:'iw_test',name:'test',status:'ACTIVE' as const,currency:'USD',totalAuthority:100,spentAmount:0,autoBuyLimit:55,maxSingleTransaction:75,allowedBrands:[],blockedBrands:[],allowedCategories:[],requiredFeatures:[],validUntil:'2099-01-01T00:00:00.000Z'};
describe('V11.4.3 financial boundary',()=>{
  it.each([NaN,Infinity,-Infinity,0,-1,'49','',null,{},0.001,Number.MIN_VALUE,1e-9])('blocks malformed money %s',amount=>{
    expect(evaluateWalletTransaction(wallet,{amount:amount as number,currency:'USD',quantity:1,brand:'Sony',category:'electronics',features:[]}).decision).toBe('BLOCK');
  });
  it.each([0,-1,1.5,NaN,Infinity,'1'])('blocks malformed quantity %s',quantity=>{
    expect(evaluateWalletTransaction(wallet,{amount:49,currency:'USD',quantity:quantity as number,brand:'Sony',category:'electronics',features:[]}).decision).toBe('BLOCK');
  });
  it('permits authenticated v1 preflight',()=>{
    const response=globalPreflightResponse();
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-intentlock-key');
  });
});

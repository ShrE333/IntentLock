import {describe,it,expect} from 'vitest';
import {sandboxWalletAvailable} from '../../../web/app/demo-evidence';
describe('redesigned demo and reservation integration',()=>{
 it('subtracts active authority holds from the displayed available amount',()=>expect(sandboxWalletAvailable({totalAuthority:100,spentAmount:20,reservedAmount:70})).toBe(10));
 it('does not offer an entirely reserved wallet as ready',()=>expect(sandboxWalletAvailable({totalAuthority:100,spentAmount:0,reservedAmount:100})).toBe(0));
 it.each([undefined,NaN,Infinity,-1])('fails closed for missing or malformed reservation counters %s',reservedAmount=>expect(sandboxWalletAvailable({totalAuthority:100,spentAmount:0,reservedAmount})).toBe(0));
 it('does not advertise negative availability from an inconsistent older response',()=>expect(sandboxWalletAvailable({totalAuthority:100,spentAmount:80,reservedAmount:30})).toBe(0));
});

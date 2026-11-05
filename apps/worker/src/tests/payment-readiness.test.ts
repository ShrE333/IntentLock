import {describe, it, expect} from 'vitest';
import {paypalReadiness} from '../session-payments/readiness';
import {paypalReturnBaseUrl} from '../session-payments/providers/paypal';
import {syntheticEnv,syntheticMapping} from './recipient-fixtures';
const env = {...syntheticEnv, PAYPAL_MERCHANT_BINDINGS_JSON:JSON.stringify([{...syntheticMapping,catalogSellerId:"audiohub-sandbox"}]), PAYPAL_CLIENT_ID:'isolated-client', PAYPAL_CLIENT_SECRET:'isolated-secret',
  PAYPAL_WEBHOOK_ID:'isolated-webhook', PAYPAL_RETURN_BASE_URL:'https://preview.example.test',
  APPROVAL_SIGNING_SECRET:'isolated-signing-secret-at-least-24', DATABASE_URL:'isolated-db'};
describe('safe PayPal configuration diagnostics', () => {
  it('reports every missing setting without claiming provider verification', () => {
    const result = paypalReadiness({});
    expect(result.ready).toBe(false);
    expect(result.missing).toHaveLength(8);
    expect(result.verification).toBe('CONFIGURATION_ONLY_NOT_PROVIDER_VERIFIED');
  });
  it('accepts a complete sandbox configuration without revealing values', () => {
    const result = paypalReadiness(env);
    expect(result.ready).toBe(true);
    for (const value of Object.values(env)) expect(JSON.stringify(result)).not.toContain(value);
  });
  it.each(['http://example.test', 'https://user:pass@example.test', 'https://example.test/?token=x', 'invalid'])('rejects unsafe return origin %s', url => {
    expect(paypalReadiness({...env, PAYPAL_RETURN_BASE_URL:url}).issues).toContain('PAYPAL_RETURN_BASE_URL_INVALID');
    expect(()=>paypalReturnBaseUrl({...env,PAYPAL_RETURN_BASE_URL:url})).toThrow('PAYPAL_RETURN_BASE_URL_INVALID');
  });
  it('permits local HTTP for sandbox only and blocks live demo execution', () => {
    expect(paypalReadiness({...env, PAYPAL_RETURN_BASE_URL:'http://localhost:3000'}).ready).toBe(true);
    expect(paypalReadiness({...env, PAYPAL_ENV:'live'}).ready).toBe(false);
  });
  it('fails closed for malformed mappings and short signing keys', () => {
    const result = paypalReadiness({...env, PAYPAL_MERCHANT_BINDINGS_JSON:'{secret-invalid', APPROVAL_SIGNING_SECRET:'short'});
    expect(result.issues).toContain('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
    expect(result.issues).toContain('APPROVAL_SIGNING_SECRET_TOO_SHORT');
    expect(JSON.stringify(result)).not.toContain('secret-invalid');
  });
});

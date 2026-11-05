import {recipientMappingConfigured, type RecipientEnv} from '../payments/recipient-binding';
import {paypalReturnBaseUrl, type PayPalEnv} from './providers/paypal';

type ReadinessEnv = PayPalEnv & RecipientEnv & {
  DATABASE_URL?: string;
  APPROVAL_SIGNING_SECRET?: string;
};

// Configuration inspection only: never calls a provider or exposes config values.
export function paypalReadiness(env: ReadinessEnv) {
  const required = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID',
    'PAYPAL_RETURN_BASE_URL', 'PAYPAL_ACCOUNT_MERCHANT_ID', 'PAYPAL_MERCHANT_BINDINGS_JSON',
    'APPROVAL_SIGNING_SECRET', 'DATABASE_URL'] as const;
  const missing = required.filter(key => !env[key]?.trim());
  const issues: string[] = [];
  const environment = env.PAYPAL_ENV ?? 'sandbox';
  if (!['sandbox', 'live'].includes(environment)) issues.push('PAYPAL_ENVIRONMENT_INVALID');
  if (environment === 'live') issues.push('DEMO_CHECKOUT_SANDBOX_ONLY');
  if (env.PAYPAL_RETURN_BASE_URL?.trim()) {
    try { paypalReturnBaseUrl(env); }
    catch { issues.push('PAYPAL_RETURN_BASE_URL_INVALID'); }
  }
  if (env.APPROVAL_SIGNING_SECRET && env.APPROVAL_SIGNING_SECRET.length < 24)
    issues.push('APPROVAL_SIGNING_SECRET_TOO_SHORT');
  if (!recipientMappingConfigured(env)) issues.push('VERIFIED_RECIPIENT_MAPPING_REQUIRED');
  return {ready: missing.length === 0 && issues.length === 0, missing, issues,
    verification: 'CONFIGURATION_ONLY_NOT_PROVIDER_VERIFIED' as const};
}

export type RazorpayEnv = {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
};

export type RazorpayPaymentLink = {
  id: string;
  short_url: string;
  status: string;
  reference_id: string;
  amount: number;
  currency: string;
  expire_by?: number | null;
};

export function rupeesToPaise(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  return Math.round(amount * 100);
}

export function buildReferenceId(idempotencyKey: string) {
  const hash = idempotencyKey.split(':').pop() ?? idempotencyKey;
  return `il_${hash.slice(0,24)}`;
}

export async function createRazorpayPaymentLink(env: RazorpayEnv, input: {
  amountRupees: number;
  currency: 'INR';
  idempotencyKey: string;
  intentId: string;
  approvalId: string;
  productId: string;
  expireBy: number;
}): Promise<RazorpayPaymentLink> {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const response = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount: rupeesToPaise(input.amountRupees),
      currency: input.currency,
      accept_partial: false,
      expire_by: input.expireBy,
      reference_id: buildReferenceId(input.idempotencyKey),
      description: `IntentLock approved purchase: ${input.productId}`,
      notes: {
        intent_id: input.intentId,
        approval_id: input.approvalId,
        product_id: input.productId,
        intentlock: 'true'
      }
    })
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(`RAZORPAY_${response.status}: ${data?.error?.description ?? 'Payment Link creation failed'}`);
  }
  return data as RazorpayPaymentLink;
}

import {resolveApiUrl} from './runtime-config';
import {financialFetch} from './demo-access';
export function requireApiUrl(){return resolveApiUrl(process.env.NEXT_PUBLIC_INTENTLOCK_API_URL,process.env.NODE_ENV==='production');}
// Retained for callers outside the app; production has no localhost fallback.
export const API=process.env.NEXT_PUBLIC_INTENTLOCK_API_URL??(process.env.NODE_ENV==='production'?'':'http://localhost:8787');

export type IntentContract = {
  id: string;
  category: string;
  maxAmount: number;
  currency: "INR";
  maxQuantity: number;
  blockedBrands: string[];
  requiredFeatures: string[];
  preferredFeatures: string[];
  requiresApproval: boolean;
  expiresAt: string;
};

export type Proposal = {
  productId: string;
  brand: string;
  category: string;
  quantity: number;
  unitPrice: number;
  currency: "INR";
  features: string[];
  inventoryAvailable: boolean;
  quoteExpiresAt: string;
};

export async function getJson<T>(path: string): Promise<T> {
  const response = await financialFetch(`${requireApiUrl()}${path}`, {
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ??
      data?.error ??
      `Request failed (${response.status})`
    );
  }

  return data as T;
}

export async function postJson<T>(
  path: string,
  body: unknown
): Promise<T> {
  const response = await financialFetch(`${requireApiUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ??
      data?.error ??
      `Request failed (${response.status})`
    );
  }

  return data as T;
}

export function saveIntent(intent: IntentContract) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    "intentlock:lastIntent",
    JSON.stringify(intent)
  );

  localStorage.setItem(
    "intentlock:lastIntentId",
    intent.id
  );
}

export function readIntent(): IntentContract | null {
  if (typeof window === "undefined") return null;

  const value = localStorage.getItem("intentlock:lastIntent");

  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getLastIntentId() {
  if (typeof window === "undefined") return "";

  return localStorage.getItem("intentlock:lastIntentId") ?? "";
}

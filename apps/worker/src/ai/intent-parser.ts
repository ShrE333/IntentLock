import { z } from "zod";
import { IntentContractSchema, type IntentContract } from "../types/contracts";

const ExtractedIntentSchema = z.object({
  category: z.string().min(1),
  maxAmount: z.number().positive(),
  currency: z.literal("INR"),
  maxQuantity: z.number().int().positive(),
  blockedBrands: z.array(z.string()),
  requiredFeatures: z.array(z.string()),
  preferredFeatures: z.array(z.string()),
  requiresApproval: z.boolean()
});

type ExtractedIntent = z.infer<typeof ExtractedIntentSchema>;

const jsonSchema = {
  type: "object",
  properties: {
    category: { type: "string" },
    maxAmount: { type: "number", exclusiveMinimum: 0 },
    currency: { type: "string", enum: ["INR"] },
    maxQuantity: { type: "integer", minimum: 1 },
    blockedBrands: {
      type: "array",
      items: { type: "string" }
    },
    requiredFeatures: {
      type: "array",
      items: { type: "string" }
    },
    preferredFeatures: {
      type: "array",
      items: { type: "string" }
    },
    requiresApproval: { type: "boolean" }
  },
  required: [
    "category",
    "maxAmount",
    "currency",
    "maxQuantity",
    "blockedBrands",
    "requiredFeatures",
    "preferredFeatures",
    "requiresApproval"
  ],
  additionalProperties: false
} as const;

const NON_PRODUCT_FEATURES = [
  "requiresapproval",
  "approval",
  "userapproval",
  "askbeforebuying",
  "paymentapproval",
  "budget",
  "price",
  "quantity",
  "merchant",
  "currency"
];

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function displayFeature(value: string): string {
  const normalized = value.trim();
  if (key(normalized) === "anc") return "ANC";
  return normalized.toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = displayFeature(value);
    const k = key(normalized);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    result.push(normalized);
  }

  return result;
}

function canonicalCategory(rawCategory: string, message: string): string {
  const combined = `${rawCategory} ${message}`.toLowerCase();

  if (/(headphones?|headsets?|earphones?)/.test(combined)) return "headphones";
  if (/keyboards?/.test(combined)) return "keyboard";
  if (/\bmice\b|\bmouse\b/.test(combined)) return "mouse";
  if (/monitors?|displays?/.test(combined)) return "monitor";
  if (/laptops?|notebooks?/.test(combined)) return "laptop";
  if (/phones?|smartphones?/.test(combined)) return "smartphone";

  return rawCategory
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

function isNonProductFeature(feature: string): boolean {
  return NON_PRODUCT_FEATURES.includes(key(feature));
}

function hasHardConstraintPhrase(message: string, feature: string): boolean {
  const msg = message.toLowerCase();
  const f = feature.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patterns = [
    new RegExp(`\\bwith\\s+(?:good\\s+)?${f}\\b`, "i"),
    new RegExp(`\\bmust\\s+(?:have|include|support)?\\s*${f}\\b`, "i"),
    new RegExp(`\\bneed(?:s|ed)?\\s+(?:to\\s+have\\s+)?${f}\\b`, "i"),
    new RegExp(`\\brequir(?:e|es|ed|ing)\\s+${f}\\b`, "i"),
    new RegExp(`\\b${f}\\s+(?:is\\s+)?mandatory\\b`, "i")
  ];

  return patterns.some((pattern) => pattern.test(msg));
}

/**
 * Security normalization layer.
 *
 * The LLM proposes a semantic interpretation. This function canonicalizes
 * categories and conservatively preserves explicit user constraints.
 * It may STRENGTHEN a constraint, but never silently weaken one.
 */
export function normalizeExtractedIntent(
  extracted: ExtractedIntent,
  message: string
): ExtractedIntent {
  const cleanMessage = message.trim();
  const lowerMessage = cleanMessage.toLowerCase();

  let required = unique(
    extracted.requiredFeatures.filter((f) => !isNonProductFeature(f))
  );

  let preferred = unique(
    extracted.preferredFeatures.filter((f) => !isNonProductFeature(f))
  );

  // "wireless headphones" is a product requirement, not a category name.
  if (/\bwireless\b/i.test(cleanMessage)) {
    const preferenceOnly =
      /\b(prefer|preferably|ideally|would like|nice to have)\b[^.]{0,40}\bwireless\b/i.test(
        cleanMessage
      );

    if (preferenceOnly) {
      preferred.push("wireless");
    } else {
      required.push("wireless");
    }
  }

  // Reclassify features when the user's wording clearly makes them mandatory.
  for (const feature of [...required, ...preferred]) {
    if (hasHardConstraintPhrase(cleanMessage, feature)) {
      required.push(feature);
      preferred = preferred.filter((p) => key(p) !== key(feature));
    }
  }

  // Explicit "ask me before buying/payment" always means approval required.
  const explicitApproval =
    /\bask\s+me\s+before\b|\bapproval\s+(?:is\s+)?required\b|\bdo\s+not\s+(?:buy|pay|purchase)\s+without\b/i.test(
      lowerMessage
    );

  return ExtractedIntentSchema.parse({
    ...extracted,
    category: canonicalCategory(extracted.category, cleanMessage),
    requiredFeatures: unique(required),
    preferredFeatures: unique(
      preferred.filter(
        (p) => !required.some((r) => key(r) === key(p))
      )
    ),
    requiresApproval: explicitApproval ? true : extracted.requiresApproval
  });
}

export async function parseIntent(
  ai: Ai,
  message: string
): Promise<IntentContract> {
  const cleanMessage = message.trim();

  if (!cleanMessage) {
    throw new Error("Purchase request cannot be empty.");
  }

  const result = await ai.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    messages: [
      {
        role: "system",
        content: [
          "Extract the user's shopping authorization into structured data.",
          "Do not invent a larger budget, quantity, or broader permission than the user gave.",
          "Use a generic product category such as headphones, keyboard, mouse, monitor, laptop or smartphone. Do not put product features into category.",
          "If quantity is not stated, use 1.",
          "If approval preference is not stated, requiresApproval must be true.",
          "requiredFeatures and preferredFeatures must contain PRODUCT FEATURES ONLY.",
          "Never put approval, budget, quantity, payment, merchant or currency rules into feature arrays.",
          "Phrases such as 'with X', 'must have X', 'need X', 'X is mandatory' make X a required feature.",
          "Phrases such as 'prefer X', 'ideally X', 'nice to have X' make X a preferred feature.",
          "Currency is INR.",
          "Return only data matching the requested JSON schema."
        ].join(" ")
      },
      {
        role: "user",
        content: cleanMessage
      }
    ],
    temperature: 0,
    max_tokens: 350,
    response_format: {
      type: "json_schema",
      json_schema: jsonSchema
    }
  });

  const raw = (result as { response?: unknown }).response;

  const extracted =
    typeof raw === "string"
      ? ExtractedIntentSchema.parse(JSON.parse(raw))
      : ExtractedIntentSchema.parse(raw);

  const normalized = normalizeExtractedIntent(extracted, cleanMessage);

  // Security-critical metadata is generated by deterministic code, never the model.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  return IntentContractSchema.parse({
    id: crypto.randomUUID(),
    ...normalized,
    expiresAt
  });
}


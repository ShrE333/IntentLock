import { handleRiskRoutes } from "./risk/routes";
import { handlePurchaseQueue } from "./queue/purchase-jobs";
import { handleAuthorizeRoutes } from "./authorize/routes";
import { handleSessionPaymentRoutes } from "./session-payments/routes";
import { handleWhatsappRoutes } from "./whatsapp/routes";
import { handleSessionRoutes } from "./sessions/routes";
import { handleCommerceRoutes } from "./commerce/routes";
import { handleWalletRoutes } from "./wallets/routes";
﻿import { runFullEvalSuite } from "./evals/run";
import { routeAgentRequest } from "agents";
import {
  IntentContractSchema,
  PurchaseProposalSchema
} from "./types/contracts";
import { evaluatePurchase } from "./policy/engine";
import { parseIntent } from "./ai/intent-parser";
import { runPromptInjectionAttack } from "./security/attack-demo";
import {
  createApprovalToken,
  verifyApprovalToken
} from "./security/approval";
import { runStalePriceDemo } from "./security/stale-price-demo";
import { runDuplicateCheckoutDemo } from "./security/duplicate-checkout-demo";
import { UpstashIdempotencyStore } from "./idempotency/store";
import { getDb, type DatabaseEnv } from "./db/client";
import {
  appendAuditEvent,
  getAuditEvents,
  hashToken,
  verifyAuditRows,
  sha256Hex
} from "./db/audit";
import {
  persistApproval,
  persistBlockedTransaction,
  persistIntent
} from "./db/repository";
import { buildCheckoutIdempotencyKey } from "./idempotency/checkout";
import { createRazorpayPaymentLink } from "./payments/razorpay";
import { verifyRazorpayWebhook } from "./payments/webhook";
import { getPaymentLinkByKey, persistPaymentLink, persistWebhook, markPaymentLinkPaid } from "./db/payment-repository";

export { PurchaseAgent } from "./agent/purchase-agent";

type EvaluateBody = {
  intent: unknown;
  proposal: unknown;
  approved?: boolean;
};

type ParseIntentBody = {
  message?: string;
};

type AppEnv = Env &
  DatabaseEnv & {
    APPROVAL_SIGNING_SECRET?: string;
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    RAZORPAY_KEY_ID?: string;
    RAZORPAY_KEY_SECRET?: string;
    RAZORPAY_WEBHOOK_SECRET?: string;
  };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-razorpay-signature",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    }
  });
}

function approvalSecret(env: AppEnv): string {
  const secret = env.APPROVAL_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "APPROVAL_SIGNING_SECRET is missing. Add it to apps/worker/.dev.vars."
    );
  }
  return secret;
}

export default {
  async queue(batch:any, env:any, ctx:any) {
    return handlePurchaseQueue(batch,env,ctx);
  },

  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as AppEnv;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type,x-razorpay-signature",
          "access-control-allow-methods": "GET,POST,OPTIONS"
        }
      });
    }

    const url = new URL(request.url);

    // V10.9 Adaptive Agent Trust & Risk Engine.
    const riskRouteResponse = await handleRiskRoutes(
      request,
      env,
      url
    );
    if (riskRouteResponse) return riskRouteResponse;

    // V10.8 external authorization control plane.
    const authorizeRouteResponse = await handleAuthorizeRoutes(
      request,
      env,
      url
    );
    if (authorizeRouteResponse) return authorizeRouteResponse;

    // V10.6 must run before the legacy V7 Razorpay webhook.
    // It handles PurchaseSession-linked payments and returns null for legacy payments.
    const sessionPaymentRouteResponse = await handleSessionPaymentRoutes(
      request.clone(),
      env,
      url
    );
    if (sessionPaymentRouteResponse) return sessionPaymentRouteResponse;

    const walletRouteResponse = await handleWalletRoutes(request, env, url);
    if (walletRouteResponse) return walletRouteResponse;

    const commerceRouteResponse = await handleCommerceRoutes(request, env, url);
    if (commerceRouteResponse) return commerceRouteResponse;

    const sessionRouteResponse = await handleSessionRoutes(request, env, url);
    if (sessionRouteResponse) return sessionRouteResponse;

    const whatsappRouteResponse = await handleWhatsappRoutes(request, env, url);
    if (whatsappRouteResponse) return whatsappRouteResponse;

    if (
      request.method === "GET" &&
      url.pathname === "/api/evals"
    ) {
      try {
        const result = await runFullEvalSuite();

        return json(result);
      } catch (error) {
        return json(
          {
            error: "EVAL_SUITE_FAILED",
            message:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    if (request.method === "POST" && url.pathname === "/webhooks/razorpay") {
      const rawBody = await request.text();
      const signature = request.headers.get("x-razorpay-signature");
      if (!await verifyRazorpayWebhook(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
        return json({ error: "INVALID_WEBHOOK_SIGNATURE" }, 401);
      }
      try {
        const payload = JSON.parse(rawBody) as any;
        const eventType = String(payload.event ?? "unknown");
        const linkId = payload?.payload?.payment_link?.entity?.id ?? null;
        const paymentId = payload?.payload?.payment?.entity?.id ?? null;
        const sql = getDb(env);
        const inserted = await persistWebhook(sql, {
          payloadHash: await sha256Hex(rawBody), eventType,
          providerEntityId: linkId, payload
        });
        if (!inserted) return json({ received: true, duplicate: true });
        if (eventType === "payment_link.paid" && linkId) {
          const applied = await markPaymentLinkPaid(sql, linkId, paymentId);
          if (applied) {
            await appendAuditEvent(sql, applied.intentId, "WEBHOOK_RECEIVED", { eventType, linkId, paymentId });
            await appendAuditEvent(sql, applied.intentId, "PAYMENT_CAPTURED", { provider: "razorpay", linkId, paymentId });
          }
        }
        return json({ received: true, duplicate: false });
      } catch (error) {
        return json({ error: "WEBHOOK_PROCESSING_FAILED", message: error instanceof Error ? error.message : String(error) }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/payments/create-link") {
      try {
        const body = await request.json() as any;
        if (typeof body.token !== "string") return json({error:"INVALID_REQUEST",message:"token required"},400);
        const intent = IntentContractSchema.parse(body.intent);
        const proposal = PurchaseProposalSchema.parse(body.proposal);
        const approval = await verifyApprovalToken(body.token, intent, proposal, approvalSecret(env));
        if (!approval.allowed) return json({ok:false,code:approval.code},409);
        const remainingMs = new Date(approval.payload.expiresAt).getTime() - Date.now();
        if (remainingMs < 15*60*1000) return json({ok:false,code:"APPROVAL_TOO_SHORT_FOR_PAYMENT_LINK",minimumRemainingSeconds:900},409);
        const sql = getDb(env);
        const idempotencyKey = await buildCheckoutIdempotencyKey(intent, proposal);
        const existing = await getPaymentLinkByKey(sql, idempotencyKey);
        if (existing) return json({ok:true,duplicate:true,idempotencyKey,paymentLink:existing});
        const store = UpstashIdempotencyStore.fromEnv(env);
        const claim = await store.claim(idempotencyKey, JSON.stringify({intentId:intent.id,approvalId:approval.payload.approvalId}), 900);
        if (!claim.acquired) return json({ok:false,code:"CHECKOUT_ALREADY_IN_PROGRESS",idempotencyKey},409);
        const amount = proposal.quantity * proposal.unitPrice;
        const providerLink = await createRazorpayPaymentLink(env, {
          amountRupees: amount, currency: proposal.currency, idempotencyKey,
          intentId: intent.id, approvalId: approval.payload.approvalId,
          productId: proposal.productId,
          expireBy: Math.floor(new Date(approval.payload.expiresAt).getTime()/1000)
        });
        const persisted = await persistPaymentLink(sql, {
          intentId:intent.id, approvalId:approval.payload.approvalId, idempotencyKey,
          providerLinkId:providerLink.id, referenceId:providerLink.reference_id,
          shortUrl:providerLink.short_url, amount, currency:proposal.currency,
          status:providerLink.status,
          expiresAt: providerLink.expire_by ? new Date(providerLink.expire_by*1000).toISOString() : approval.payload.expiresAt
        });
        await appendAuditEvent(sql, intent.id, "PAYMENT_LINK_CREATED", {provider:"razorpay",providerLinkId:providerLink.id,amount,idempotencyKey});
        return json({ok:true,duplicate:false,idempotencyKey,paymentLink:persisted});
      } catch (error) {
        return json({error:"PAYMENT_LINK_CREATION_FAILED",message:error instanceof Error ? error.message : String(error)},400);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/intents/parse") {
      try {
        const body = (await request.json()) as ParseIntentBody;

        if (typeof body.message !== "string") {
          return json(
            {
              error: "INVALID_REQUEST",
              message: "Expected JSON body: { message: string }"
            },
            400
          );
        }

        const intent = await parseIntent(env.AI, body.message);
        const sql = getDb(env);

        await persistIntent(sql, intent);
        await appendAuditEvent(sql, intent.id, "INTENT_CREATED", {
          intent,
          source: "workers-ai",
          model: "@cf/meta/llama-3.1-8b-instruct-fast"
        });

        return json({
          intent,
          persisted: true,
          source: "workers-ai",
          model: "@cf/meta/llama-3.1-8b-instruct-fast"
        });
      } catch (error) {
        return json(
          {
            error: "INTENT_EXTRACTION_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          422
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/approvals/create"
    ) {
      try {
        const body = (await request.json()) as {
          intent: unknown;
          proposal: unknown;
          ttlSeconds?: number;
        };

        const intent = IntentContractSchema.parse(body.intent);
        const proposal = PurchaseProposalSchema.parse(body.proposal);
        const sql = getDb(env);

        await persistIntent(sql, intent);

        const approval = await createApprovalToken(
          intent,
          proposal,
          approvalSecret(env),
          body.ttlSeconds ?? 300
        );

        await persistApproval(
          sql,
          approval.payload,
          await hashToken(approval.token)
        );

        await appendAuditEvent(
          sql,
          intent.id,
          "APPROVAL_CREATED",
          {
            approvalId: approval.payload.approvalId,
            quoteHash: approval.payload.quoteHash,
            productId: proposal.productId,
            amount: approval.payload.amount,
            quantity: proposal.quantity,
            expiresAt: approval.payload.expiresAt
          }
        );

        return json({
          approval,
          approvalCard: {
            productId: proposal.productId,
            brand: proposal.brand,
            quantity: proposal.quantity,
            amount: proposal.quantity * proposal.unitPrice,
            currency: proposal.currency,
            expiresAt: approval.payload.expiresAt,
            exactQuoteBound: true
          },
          persisted: true
        });
      } catch (error) {
        return json(
          {
            error: "APPROVAL_CREATION_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/approvals/verify"
    ) {
      try {
        const body = (await request.json()) as {
          token?: string;
          intent: unknown;
          proposal: unknown;
        };

        if (typeof body.token !== "string") {
          return json(
            {
              error: "INVALID_REQUEST",
              message: "token must be a string"
            },
            400
          );
        }

        const intent = IntentContractSchema.parse(body.intent);
        const proposal = PurchaseProposalSchema.parse(body.proposal);
        const result = await verifyApprovalToken(
          body.token,
          intent,
          proposal,
          approvalSecret(env)
        );

        const sql = getDb(env);
        await persistIntent(sql, intent);

        await appendAuditEvent(
          sql,
          intent.id,
          result.allowed ? "APPROVAL_VERIFIED" : "TRANSACTION_BLOCKED",
          {
            result,
            productId: proposal.productId,
            amount: proposal.quantity * proposal.unitPrice
          }
        );

        return json(result, result.allowed ? 200 : 409);
      } catch (error) {
        return json(
          {
            error: "APPROVAL_VERIFICATION_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/security/prompt-injection-demo"
    ) {
      try {
        const body = await request.json();
        const result = runPromptInjectionAttack(body);
        const intent = IntentContractSchema.parse(
          (body as { intent: unknown }).intent
        );
        const sql = getDb(env);

        await persistIntent(sql, intent);

        await appendAuditEvent(sql, intent.id, "MERCHANT_DATA_READ", {
          productId: result.attack.merchantProductId,
          merchantText: result.attack.maliciousMerchantText
        });

        await appendAuditEvent(sql, intent.id, "AGENT_PROPOSAL_CREATED", {
          proposal: result.agentProposal,
          compromisedByFixture: true
        });

        await appendAuditEvent(sql, intent.id, "POLICY_CHECKED", {
          decision: result.policyDecision
        });

        await appendAuditEvent(sql, intent.id, "TRANSACTION_BLOCKED", {
          reason: result.policyDecision.code,
          violations: result.policyDecision.violations,
          attemptedAmount: result.policyDecision.totalAmount,
          moneyMoved: result.moneyMoved
        });

        return json({
          demo: "PROMPT_INJECTION_ATTACK",
          ...result,
          auditPersisted: true
        });
      } catch (error) {
        return json(
          {
            error: "ATTACK_DEMO_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/security/stale-price-demo"
    ) {
      try {
        const body = await request.json();
        const result = await runStalePriceDemo(
          body,
          approvalSecret(env)
        );

        const typedBody = body as {
          intent: unknown;
          proposal: {
            quantity: number;
          };
        };

        const intent = IntentContractSchema.parse(
          typedBody.intent
        );

        const sql = getDb(env);

        await persistIntent(sql, intent);

        await appendAuditEvent(sql, intent.id, "APPROVAL_CREATED", {
          approvalId: result.approval.approvalId,
          approvedAmount: result.approval.approvedAmount,
          approvedQuoteHash: result.approval.approvedQuoteHash,
          expiresAt: result.approval.expiresAt
        });

        await appendAuditEvent(sql, intent.id, "QUOTE_CHANGED", {
          originalUnitPrice: result.merchantChange.originalUnitPrice,
          currentUnitPrice: result.merchantChange.currentUnitPrice,
          delta: result.merchantChange.delta,
          verificationCode: result.checkoutVerification.code
        });

        await appendAuditEvent(sql, intent.id, "TRANSACTION_BLOCKED", {
          reason: result.checkoutVerification.code,
          approvedAmount: result.approval.approvedAmount,
          attemptedAmount:
            result.merchantChange.currentUnitPrice *
            typedBody.proposal.quantity,
          moneyMoved: result.moneyMoved
        });

        return json({
          ...result,
          auditPersisted: true
        });
      } catch (error) {
        return json(
          {
            error: "STALE_PRICE_DEMO_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/security/duplicate-checkout-demo"
    ) {
      try {
        const body = await request.json();
        const typed = body as {
          intent: unknown;
          proposal: unknown;
        };

        const intent = IntentContractSchema.parse(typed.intent);
        const proposal = PurchaseProposalSchema.parse(typed.proposal);
        const store = UpstashIdempotencyStore.fromEnv(env);

        const result = await runDuplicateCheckoutDemo(body, store);
        const sql = getDb(env);

        await persistIntent(sql, intent);

        if (result.idempotencyKey) {
          await appendAuditEvent(
            sql,
            intent.id,
            "IDEMPOTENCY_CLAIMED",
            {
              idempotencyKey: result.idempotencyKey,
              paymentAttempts: result.paymentAttempts
            }
          );

          await persistBlockedTransaction(
            sql,
            {
              intentId: intent.id,
              idempotencyKey: result.idempotencyKey,
              amount:
                proposal.quantity *
                proposal.unitPrice,
              currency: proposal.currency
            }
          );
        }

        for (const attempt of result.attempts.slice(1)) {
          await appendAuditEvent(
            sql,
            intent.id,
            "DUPLICATE_CHECKOUT_REJECTED",
            attempt
          );
        }

        return json({
          ...result,
          auditPersisted: true
        });
      } catch (error) {
        return json(
          {
            error: "DUPLICATE_CHECKOUT_DEMO_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/audit/")
    ) {
      try {
        const streamId = decodeURIComponent(
          url.pathname.slice("/api/audit/".length)
        );

        if (!streamId) {
          return json(
            {
              error: "INVALID_REQUEST",
              message: "Missing audit stream ID."
            },
            400
          );
        }

        const sql = getDb(env);
        const events = await getAuditEvents(sql, streamId);
        const verification = await verifyAuditRows(events);

        return json({
          streamId,
          eventCount: events.length,
          chain: verification,
          events
        });
      } catch (error) {
        return json(
          {
            error: "AUDIT_READ_FAILED",
            message: error instanceof Error ? error.message : String(error)
          },
          500
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/api/evaluate") {
      try {
        const body = (await request.json()) as EvaluateBody;
        const intent = IntentContractSchema.parse(body.intent);
        const proposal = PurchaseProposalSchema.parse(body.proposal);

        return json(
          evaluatePurchase(intent, proposal, body.approved ?? false)
        );
      } catch (error) {
        return json(
          {
            error: "INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error)
          },
          400
        );
      }
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    if (url.pathname === "/health") {
      return json({
        service: "intentlock-worker",
        status: "ok",
        version: "v10.9",
        databaseConfigured: Boolean(env.DATABASE_URL),
        redisConfigured: Boolean(
          env.UPSTASH_REDIS_REST_URL &&
          env.UPSTASH_REDIS_REST_TOKEN
        ),
        razorpayConfigured: Boolean(
          env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
        ),
        webhookConfigured: Boolean(env.RAZORPAY_WEBHOOK_SECRET)
      });
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};


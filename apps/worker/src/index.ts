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
import { getDb, type DatabaseEnv } from "./db/client";
import {
  appendAuditEvent,
  getAuditEvents,
  hashToken,
  verifyAuditRows
} from "./db/audit";
import {
  persistApproval,
  persistIntent
} from "./db/repository";

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
  };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
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
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as AppEnv;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST,OPTIONS"
        }
      });
    }

    const url = new URL(request.url);

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

        const intent = IntentContractSchema.parse(
          (body as { intent: unknown }).intent
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
            Number((body as any).proposal.quantity),
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
        version: "v5",
        databaseConfigured: Boolean(env.DATABASE_URL)
      });
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};

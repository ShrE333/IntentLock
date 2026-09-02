import { routeAgentRequest } from "agents";
import {
  IntentContractSchema,
  PurchaseProposalSchema
} from "./types/contracts";
import { evaluatePurchase } from "./policy/engine";
import { parseIntent } from "./ai/intent-parser";
import { runPromptInjectionAttack } from "./security/attack-demo";

export { PurchaseAgent } from "./agent/purchase-agent";

type EvaluateBody = {
  intent: unknown;
  proposal: unknown;
  approved?: boolean;
};

type ParseIntentBody = {
  message?: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

        return json({
          intent,
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
      url.pathname === "/api/security/prompt-injection-demo"
    ) {
      try {
        const body = await request.json();
        const result = runPromptInjectionAttack(body);

        return json({
          demo: "PROMPT_INJECTION_ATTACK",
          ...result
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
        version: "v3"
      });
    }

    return json({ error: "NOT_FOUND" }, 404);
  }
};

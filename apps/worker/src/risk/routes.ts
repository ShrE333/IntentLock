import {
  evaluateAgentRisk
} from "./engine";
import {
  getRiskAssessmentBySession,
  getWalletRiskSummary
} from "./repository";
import type {
  AgentRiskContext,
  AgentRiskInput
} from "./types";

const headers={
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,POST,OPTIONS",
  "access-control-allow-headers":"content-type"
};

const json=(body:unknown,status=200)=>
  new Response(
    JSON.stringify(body,null,2),
    {status,headers}
  );

type Env={
  DATABASE_URL?:string;
};

const numeric=(v:unknown)=>Number(v??0);

export async function handleRiskRoutes(
  request:Request,
  env:Env,
  url:URL
):Promise<Response|null>{
  if(!url.pathname.startsWith("/api/risk"))
    return null;

  if(request.method==="OPTIONS")
    return new Response(
      null,
      {status:204,headers}
    );

  if(
    request.method==="GET" &&
    url.pathname==="/api/risk/status"
  ){
    return json({
      engine:"IntentLock Adaptive Agent Trust",
      version:"v10.9",
      scoreRange:[0,100],
      thresholds:{
        LOW:"80-100",
        MEDIUM:"50-79",
        HIGH:"0-49"
      },
      invariant:
        "Risk may restrict execution but can never expand Intent Wallet authority."
    });
  }

  // Pure deterministic evaluator useful for Security Lab demos.
  if(
    request.method==="POST" &&
    url.pathname==="/api/risk/evaluate"
  ){
    const b:any=await request.json();

    const input:AgentRiskInput={
      sessionId:String(
        b.sessionId??"risk_demo"
      ),
      walletId:String(
        b.walletId??"demo_wallet"
      ),
      agentId:String(
        b.agentId??"intentlock-purchase-agent"
      ),
      merchant:b.merchant==null
        ?null
        :String(b.merchant),
      amount:numeric(b.amount),
      currency:String(
        b.currency??"INR"
      ).toUpperCase(),
      policyDecision:String(
        b.policyDecision??"ALLOW"
      ).toUpperCase() as AgentRiskInput["policyDecision"],
      selectedMerchantMessage:
        b.selectedMerchantMessage==null
          ?null
          :String(b.selectedMerchantMessage),
      searchMerchantMessages:
        Array.isArray(b.searchMerchantMessages)
          ?b.searchMerchantMessages.map(String)
          :[]
    };

    const context:AgentRiskContext={
      capturedCount:numeric(
        b.context?.capturedCount
      ),
      averageCapturedAmount:numeric(
        b.context?.averageCapturedAmount
      ),
      failedCount30d:numeric(
        b.context?.failedCount30d
      ),
      recentSessions1h:numeric(
        b.context?.recentSessions1h
      ),
      recentBlocks30d:numeric(
        b.context?.recentBlocks30d
      ),
      recentStepUps30d:numeric(
        b.context?.recentStepUps30d
      ),
      recentQuoteChanges30d:numeric(
        b.context?.recentQuoteChanges30d
      ),
      recentReplayAttempts30d:numeric(
        b.context?.recentReplayAttempts30d
      ),
      knownMerchantPurchases:numeric(
        b.context?.knownMerchantPurchases
      ),
      previousAssessments:numeric(
        b.context?.previousAssessments
      ),
      averagePreviousTrustScore:
        b.context?.averagePreviousTrustScore==null
          ?null
          :numeric(
            b.context.averagePreviousTrustScore
          ),
      walletAutoBuyLimit:numeric(
        b.context?.walletAutoBuyLimit
      ),
      walletHardCeiling:numeric(
        b.context?.walletHardCeiling
      )
    };

    if(
      !["ALLOW","STEP_UP","BLOCK"]
        .includes(input.policyDecision)
    ){
      return json(
        {error:"INVALID_POLICY_DECISION"},
        400
      );
    }

    return json({
      assessment:evaluateAgentRisk(
        input,
        context
      )
    });
  }

  if(!env.DATABASE_URL)
    return json(
      {error:"DATABASE_NOT_CONFIGURED"},
      500
    );

  const sessionMatch=
    url.pathname.match(
      /^\/api\/risk\/session\/([^/]+)$/
    );

  if(
    request.method==="GET" &&
    sessionMatch
  ){
    const assessment=
      await getRiskAssessmentBySession(
        env.DATABASE_URL,
        decodeURIComponent(
          sessionMatch[1]
        )
      );

    if(!assessment)
      return json(
        {error:"RISK_ASSESSMENT_NOT_FOUND"},
        404
      );

    return json({assessment});
  }

  const walletMatch=
    url.pathname.match(
      /^\/api\/risk\/wallet\/([^/]+)\/summary$/
    );

  if(
    request.method==="GET" &&
    walletMatch
  ){
    return json(
      await getWalletRiskSummary(
        env.DATABASE_URL,
        decodeURIComponent(
          walletMatch[1]
        )
      )
    );
  }

  return json(
    {error:"RISK_ROUTE_NOT_FOUND"},
    404
  );
}

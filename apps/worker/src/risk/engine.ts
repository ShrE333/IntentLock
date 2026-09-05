import type {
  AgentRiskAssessment,
  AgentRiskContext,
  AgentRiskInput,
  RiskAction,
  RiskLevel,
  RiskSignal
} from "./types";

const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));

export function containsPromptInjection(text:string|null|undefined){
  if(!text) return false;

  return [
    /ignore\s+(the\s+)?(previous|user|system|policy)/i,
    /system\s+override/i,
    /developer\s+(message|instruction)/i,
    /approved\s+all\s+(future\s+)?purchases/i,
    /bypass\s+(the\s+)?(policy|approval|limit)/i,
    /override\s+(the\s+)?(spending|wallet|authorization)/i,
    /increase\s+(the\s+)?quantity/i,
    /complete\s+checkout\s+immediately/i,
    /do\s+not\s+ask\s+(the\s+)?user/i
  ].some(pattern=>pattern.test(text));
}

function level(score:number):RiskLevel{
  if(score>=80) return "LOW";
  if(score>=50) return "MEDIUM";
  return "HIGH";
}

function action(
  policyDecision:AgentRiskInput["policyDecision"],
  riskLevel:RiskLevel
):RiskAction{
  // HARD POLICY ALWAYS DOMINATES.
  if(policyDecision==="BLOCK") return "BLOCK";

  // Risk can never convert STEP_UP into ALLOW.
  if(policyDecision==="STEP_UP") return "STEP_UP";

  // The only adaptive restriction:
  // an otherwise ALLOW transaction becomes human-approved when HIGH risk.
  if(riskLevel==="HIGH") return "STEP_UP";

  return "OBSERVE";
}

export function evaluateAgentRisk(
  input:AgentRiskInput,
  context:AgentRiskContext
):Omit<
  AgentRiskAssessment,
  "assessmentId"|"createdAt"
>{
  let score=100;
  const signals:RiskSignal[]=[];

  const add=(
    code:string,
    severity:RiskSignal["severity"],
    delta:number,
    detail:string
  )=>{
    score+=delta;
    signals.push({code,severity,delta,detail});
  };

  const selectedInjection=
    containsPromptInjection(input.selectedMerchantMessage);

  const searchInjectionExposure=
    (input.searchMerchantMessages??[])
      .some(containsPromptInjection);

  if(selectedInjection){
    add(
      "SELECTED_MERCHANT_PROMPT_INJECTION",
      "CRITICAL",
      -45,
      "The selected product contains merchant-controlled text matching prompt-injection patterns."
    );
  }else if(searchInjectionExposure){
    add(
      "SEARCH_PROMPT_INJECTION_EXPOSURE",
      "MEDIUM",
      -8,
      "The agent was exposed to suspicious merchant-controlled text during product search."
    );
  }

  const hardCeiling=Math.max(
    0,
    Number(context.walletHardCeiling||0)
  );

  if(
    hardCeiling>0 &&
    input.amount/hardCeiling>=0.90
  ){
    add(
      "NEAR_HARD_SPENDING_CEILING",
      "MEDIUM",
      -10,
      "The transaction is at least 90% of the wallet hard single-transaction ceiling."
    );
  }

  const average=Math.max(
    0,
    Number(context.averageCapturedAmount||0)
  );

  if(
    context.capturedCount>=2 &&
    average>0 &&
    input.amount>=average*1.75
  ){
    add(
      "AMOUNT_ANOMALY",
      "HIGH",
      -15,
      `Amount is materially above the wallet's historical captured-purchase average of ₹${Math.round(average)}.`
    );
  }

  if(context.recentSessions1h>=5){
    add(
      "RAPID_PURCHASE_FREQUENCY",
      "HIGH",
      -12,
      `${context.recentSessions1h} PurchaseSessions were created for this wallet within the last hour.`
    );
  }

  if(context.recentBlocks30d>=3){
    add(
      "RECENT_POLICY_BLOCKS",
      "MEDIUM",
      -10,
      `${context.recentBlocks30d} policy-blocked PurchaseSessions occurred in the last 30 days.`
    );
  }

  if(context.failedCount30d>=2){
    add(
      "RECENT_FAILED_PURCHASES",
      "MEDIUM",
      -10,
      `${context.failedCount30d} failed/rejected/cancelled purchases occurred in the last 30 days.`
    );
  }

  if(context.recentQuoteChanges30d>=1){
    add(
      "RECENT_QUOTE_CHANGE",
      "HIGH",
      -18,
      "A recent purchase was stopped because live commerce facts changed after authorization."
    );
  }

  if(context.recentReplayAttempts30d>=1){
    add(
      "RECENT_REPLAY_OR_DUPLICATE_ATTEMPT",
      "CRITICAL",
      -20,
      "Recent transaction history contains replay/duplicate authorization evidence."
    );
  }

  if(context.recentStepUps30d>=3){
    add(
      "FREQUENT_STEP_UPS",
      "LOW",
      -6,
      `${context.recentStepUps30d} recent transactions required explicit human approval.`
    );
  }

  if(context.capturedCount===0){
    add(
      "COLD_START_AGENT_HISTORY",
      "LOW",
      -5,
      "No captured-purchase history exists yet for this wallet."
    );
  }else if(context.capturedCount>=3){
    add(
      "ESTABLISHED_SUCCESS_HISTORY",
      "INFO",
      +5,
      `${context.capturedCount} captured purchases provide established execution history.`
    );
  }

  if(input.merchant){
    if(context.knownMerchantPurchases===0){
      add(
        "NEW_MERCHANT",
        "LOW",
        -6,
        "No previously captured purchase from this merchant was found for the wallet."
      );
    }else{
      add(
        "KNOWN_MERCHANT",
        "INFO",
        +3,
        `${context.knownMerchantPurchases} previous captured purchase(s) from this merchant were found.`
      );
    }
  }

  const trustScore=clamp(score);
  const riskLevel=level(trustScore);
  const riskAction=action(
    input.policyDecision,
    riskLevel
  );

  return {
    sessionId:input.sessionId,
    walletId:input.walletId,
    agentId:input.agentId,
    merchant:input.merchant,
    amount:input.amount,
    currency:input.currency,
    policyDecision:input.policyDecision,
    trustScore,
    riskLevel,
    riskAction,
    signals,
    metrics:context,
    engineVersion:"v10.9"
  };
}

import {neon} from "@neondatabase/serverless";
import type {
  AgentRiskAssessment,
  AgentRiskContext
} from "./types";

function number(v:unknown){
  const n=Number(v??0);
  return Number.isFinite(n)?n:0;
}

export async function loadAgentRiskContext(
  db:string,
  input:{
    walletId:string;
    merchant:string|null;
  }
):Promise<AgentRiskContext>{
  const merchant=input.merchant??"";

  // One Neon HTTP request for all behavioral/history features.
  const rows=await neon(db)`
    SELECT
      (
        SELECT COUNT(*)
        FROM purchase_sessions ps
        WHERE ps.wallet_id=${input.walletId}
          AND ps.status='CAPTURED'
      ) AS captured_count,

      (
        SELECT COALESCE(AVG(ps.captured_amount),0)
        FROM purchase_sessions ps
        WHERE ps.wallet_id=${input.walletId}
          AND ps.status='CAPTURED'
          AND ps.captured_amount IS NOT NULL
      ) AS average_captured_amount,

      (
        SELECT COUNT(*)
        FROM purchase_sessions ps
        WHERE ps.wallet_id=${input.walletId}
          AND ps.status IN ('FAILED','REJECTED','CANCELLED')
          AND ps.updated_at >= NOW()-INTERVAL '30 days'
      ) AS failed_count_30d,

      (
        SELECT COUNT(*)
        FROM purchase_sessions ps
        WHERE ps.wallet_id=${input.walletId}
          AND ps.created_at >= NOW()-INTERVAL '1 hour'
      ) AS recent_sessions_1h,

      (
        SELECT COUNT(*)
        FROM purchase_session_events pse
        JOIN purchase_sessions ps
          ON ps.session_id=pse.session_id
        WHERE ps.wallet_id=${input.walletId}
          AND pse.event_type='SESSION_BLOCKED'
          AND pse.occurred_at >= NOW()-INTERVAL '30 days'
      ) AS recent_blocks_30d,

      (
        SELECT COUNT(*)
        FROM purchase_session_events pse
        JOIN purchase_sessions ps
          ON ps.session_id=pse.session_id
        WHERE ps.wallet_id=${input.walletId}
          AND pse.event_type IN (
            'STEP_UP_REQUIRED',
            'RISK_STEP_UP_REQUIRED'
          )
          AND pse.occurred_at >= NOW()-INTERVAL '30 days'
      ) AS recent_step_ups_30d,

      (
        SELECT COUNT(*)
        FROM purchase_session_events pse
        JOIN purchase_sessions ps
          ON ps.session_id=pse.session_id
        WHERE ps.wallet_id=${input.walletId}
          AND pse.event_type='COMMERCE_QUOTE_CHANGED'
          AND pse.occurred_at >= NOW()-INTERVAL '30 days'
      ) AS recent_quote_changes_30d,

      (
        SELECT COUNT(*)
        FROM purchase_session_events pse
        JOIN purchase_sessions ps
          ON ps.session_id=pse.session_id
        WHERE ps.wallet_id=${input.walletId}
          AND pse.event_type IN (
            'DUPLICATE_CHECKOUT_REJECTED',
            'AUTHORIZATION_REPLAY_REJECTED',
            'ONE_TIME_AUTHORIZATION_REPLAY_REJECTED'
          )
          AND pse.occurred_at >= NOW()-INTERVAL '30 days'
      ) AS recent_replay_attempts_30d,

      (
        SELECT COUNT(*)
        FROM purchase_sessions ps
        WHERE ps.wallet_id=${input.walletId}
          AND ps.status='CAPTURED'
          AND ${merchant} <> ''
          AND LOWER(
            COALESCE(ps.selected_product->>'merchant','')
          )=LOWER(${merchant})
      ) AS known_merchant_purchases,

      (
        SELECT COUNT(*)
        FROM agent_risk_assessments ara
        WHERE ara.wallet_id=${input.walletId}
      ) AS previous_assessments,

      (
        SELECT AVG(ara.trust_score)
        FROM agent_risk_assessments ara
        WHERE ara.wallet_id=${input.walletId}
      ) AS average_previous_trust_score,

      (
        SELECT iw.auto_buy_limit
        FROM intent_wallets iw
        WHERE iw.wallet_id=${input.walletId}
        LIMIT 1
      ) AS wallet_auto_buy_limit,

      (
        SELECT iw.max_single_transaction
        FROM intent_wallets iw
        WHERE iw.wallet_id=${input.walletId}
        LIMIT 1
      ) AS wallet_hard_ceiling
  `;

  const row:any=rows[0]??{};

  return {
    capturedCount:number(row.captured_count),
    averageCapturedAmount:number(
      row.average_captured_amount
    ),
    failedCount30d:number(row.failed_count_30d),
    recentSessions1h:number(row.recent_sessions_1h),
    recentBlocks30d:number(row.recent_blocks_30d),
    recentStepUps30d:number(row.recent_step_ups_30d),
    recentQuoteChanges30d:number(
      row.recent_quote_changes_30d
    ),
    recentReplayAttempts30d:number(
      row.recent_replay_attempts_30d
    ),
    knownMerchantPurchases:number(
      row.known_merchant_purchases
    ),
    previousAssessments:number(
      row.previous_assessments
    ),
    averagePreviousTrustScore:
      row.average_previous_trust_score==null
        ?null
        :number(row.average_previous_trust_score),
    walletAutoBuyLimit:number(
      row.wallet_auto_buy_limit
    ),
    walletHardCeiling:number(
      row.wallet_hard_ceiling
    )
  };
}

export async function saveRiskAssessment(
  db:string,
  assessment:Omit<
    AgentRiskAssessment,
    "assessmentId"|"createdAt"
  >
):Promise<AgentRiskAssessment>{
  const assessmentId=
    `risk_${crypto.randomUUID()}`;

  const rows=await neon(db)`
    INSERT INTO agent_risk_assessments(
      assessment_id,
      session_id,
      wallet_id,
      agent_id,
      merchant,
      amount,
      currency,
      policy_decision,
      trust_score,
      risk_level,
      risk_action,
      signals,
      metrics,
      engine_version
    )
    VALUES(
      ${assessmentId},
      ${assessment.sessionId},
      ${assessment.walletId},
      ${assessment.agentId},
      ${assessment.merchant},
      ${assessment.amount},
      ${assessment.currency},
      ${assessment.policyDecision},
      ${assessment.trustScore},
      ${assessment.riskLevel},
      ${assessment.riskAction},
      ${JSON.stringify(assessment.signals)}::jsonb,
      ${JSON.stringify(assessment.metrics)}::jsonb,
      ${assessment.engineVersion}
    )
    ON CONFLICT(session_id)
    DO UPDATE SET
      wallet_id=EXCLUDED.wallet_id,
      agent_id=EXCLUDED.agent_id,
      merchant=EXCLUDED.merchant,
      amount=EXCLUDED.amount,
      currency=EXCLUDED.currency,
      policy_decision=EXCLUDED.policy_decision,
      trust_score=EXCLUDED.trust_score,
      risk_level=EXCLUDED.risk_level,
      risk_action=EXCLUDED.risk_action,
      signals=EXCLUDED.signals,
      metrics=EXCLUDED.metrics,
      engine_version=EXCLUDED.engine_version,
      updated_at=NOW()
    RETURNING *
  `;

  const row:any=rows[0];

  return {
    assessmentId:String(row.assessment_id),
    sessionId:String(row.session_id),
    walletId:String(row.wallet_id),
    agentId:String(row.agent_id),
    merchant:row.merchant==null
      ?null
      :String(row.merchant),
    amount:Number(row.amount),
    currency:String(row.currency),
    policyDecision:String(
      row.policy_decision
    ) as AgentRiskAssessment["policyDecision"],
    trustScore:Number(row.trust_score),
    riskLevel:String(
      row.risk_level
    ) as AgentRiskAssessment["riskLevel"],
    riskAction:String(
      row.risk_action
    ) as AgentRiskAssessment["riskAction"],
    signals:Array.isArray(row.signals)
      ?row.signals
      :[],
    metrics:(row.metrics??{}) as AgentRiskContext,
    engineVersion:"v10.9",
    createdAt:new Date(
      String(row.created_at)
    ).toISOString()
  };
}

export async function getRiskAssessmentBySession(
  db:string,
  sessionId:string
):Promise<AgentRiskAssessment|null>{
  const rows=await neon(db)`
    SELECT *
    FROM agent_risk_assessments
    WHERE session_id=${sessionId}
    LIMIT 1
  `;

  if(!rows.length) return null;

  const row:any=rows[0];

  return {
    assessmentId:String(row.assessment_id),
    sessionId:String(row.session_id),
    walletId:String(row.wallet_id),
    agentId:String(row.agent_id),
    merchant:row.merchant==null
      ?null
      :String(row.merchant),
    amount:Number(row.amount),
    currency:String(row.currency),
    policyDecision:String(
      row.policy_decision
    ) as AgentRiskAssessment["policyDecision"],
    trustScore:Number(row.trust_score),
    riskLevel:String(
      row.risk_level
    ) as AgentRiskAssessment["riskLevel"],
    riskAction:String(
      row.risk_action
    ) as AgentRiskAssessment["riskAction"],
    signals:Array.isArray(row.signals)
      ?row.signals
      :[],
    metrics:(row.metrics??{}) as AgentRiskContext,
    engineVersion:"v10.9",
    createdAt:new Date(
      String(row.created_at)
    ).toISOString()
  };
}

export async function getWalletRiskSummary(
  db:string,
  walletId:string
){
  const rows=await neon(db)`
    SELECT
      COUNT(*) AS assessment_count,
      COALESCE(AVG(trust_score),0) AS average_trust_score,
      COALESCE(MIN(trust_score),0) AS minimum_trust_score,
      COUNT(*) FILTER (
        WHERE risk_level='HIGH'
      ) AS high_risk_count,
      COUNT(*) FILTER (
        WHERE risk_action='STEP_UP'
      ) AS risk_step_up_count
    FROM agent_risk_assessments
    WHERE wallet_id=${walletId}
  `;

  const latest=await neon(db)`
    SELECT
      assessment_id,
      session_id,
      agent_id,
      merchant,
      amount,
      currency,
      policy_decision,
      trust_score,
      risk_level,
      risk_action,
      signals,
      created_at
    FROM agent_risk_assessments
    WHERE wallet_id=${walletId}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const row:any=rows[0]??{};

  return {
    walletId,
    assessmentCount:number(
      row.assessment_count
    ),
    averageTrustScore:Math.round(
      number(row.average_trust_score)
    ),
    minimumTrustScore:number(
      row.minimum_trust_score
    ),
    highRiskCount:number(
      row.high_risk_count
    ),
    riskStepUpCount:number(
      row.risk_step_up_count
    ),
    latest:latest.map((x:any)=>({
      assessmentId:String(x.assessment_id),
      sessionId:String(x.session_id),
      agentId:String(x.agent_id),
      merchant:x.merchant==null
        ?null
        :String(x.merchant),
      amount:Number(x.amount),
      currency:String(x.currency),
      policyDecision:String(
        x.policy_decision
      ),
      trustScore:Number(x.trust_score),
      riskLevel:String(x.risk_level),
      riskAction:String(x.risk_action),
      signals:Array.isArray(x.signals)
        ?x.signals
        :[],
      createdAt:new Date(
        String(x.created_at)
      ).toISOString()
    }))
  };
}

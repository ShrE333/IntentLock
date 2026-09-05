import {
  evaluateAgentRisk
} from "./engine";
import {
  getRiskAssessmentBySession,
  loadAgentRiskContext,
  saveRiskAssessment
} from "./repository";
import type {
  AgentRiskAssessment,
  AgentRiskInput
} from "./types";

export async function assessSessionRisk(
  db:string,
  input:AgentRiskInput,
  options:{reuseExisting?:boolean}={}
):Promise<AgentRiskAssessment>{
  if(options.reuseExisting!==false){
    const existing=
      await getRiskAssessmentBySession(
        db,
        input.sessionId
      );

    if(existing) return existing;
  }

  const context=await loadAgentRiskContext(
    db,
    {
      walletId:input.walletId,
      merchant:input.merchant
    }
  );

  const evaluated=evaluateAgentRisk(
    input,
    context
  );

  return saveRiskAssessment(
    db,
    evaluated
  );
}

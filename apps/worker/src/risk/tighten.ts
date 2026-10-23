import type {WalletEvaluation} from '../wallets/types';
import type {AgentRiskInput} from './types';
import {assessSessionRisk} from './service';

export function tightenEvaluation(evaluation:WalletEvaluation,action:string):WalletEvaluation{
  if(evaluation.decision==='BLOCK'||action==='OBSERVE') return evaluation;
  if(action==='BLOCK') return {...evaluation,decision:'BLOCK',violations:[...evaluation.violations,'RISK_BLOCK'],canAutoExecute:false,requiresHumanApproval:false};
  if(action==='STEP_UP'&&evaluation.decision==='ALLOW') return {...evaluation,decision:'STEP_UP',reasons:[...evaluation.reasons,'Behavioral risk requires explicit approval for this quote.'],additionalAuthorityRequired:0,canAutoExecute:false,requiresHumanApproval:true};
  return evaluation;
}
export async function assessAndTighten(db:string,input:AgentRiskInput,evaluation:WalletEvaluation){
  const assessment=await assessSessionRisk(db,input,{reuseExisting:false});
  return {assessment,evaluation:tightenEvaluation(evaluation,assessment.riskAction)};
}

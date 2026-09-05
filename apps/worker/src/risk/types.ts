export type RiskLevel="LOW"|"MEDIUM"|"HIGH";
export type RiskAction="OBSERVE"|"STEP_UP"|"BLOCK";

export type RiskSignalSeverity=
  |"INFO"
  |"LOW"
  |"MEDIUM"
  |"HIGH"
  |"CRITICAL";

export type RiskSignal={
  code:string;
  severity:RiskSignalSeverity;
  delta:number;
  detail:string;
};

export type AgentRiskContext={
  capturedCount:number;
  averageCapturedAmount:number;
  failedCount30d:number;
  recentSessions1h:number;
  recentBlocks30d:number;
  recentStepUps30d:number;
  recentQuoteChanges30d:number;
  recentReplayAttempts30d:number;
  knownMerchantPurchases:number;
  previousAssessments:number;
  averagePreviousTrustScore:number|null;
  walletAutoBuyLimit:number;
  walletHardCeiling:number;
};

export type AgentRiskInput={
  sessionId:string;
  walletId:string;
  agentId:string;
  merchant:string|null;
  amount:number;
  currency:string;
  policyDecision:"ALLOW"|"STEP_UP"|"BLOCK";
  selectedMerchantMessage?:string|null;
  searchMerchantMessages?:string[];
};

export type AgentRiskAssessment={
  assessmentId:string;
  sessionId:string;
  walletId:string;
  agentId:string;
  merchant:string|null;
  amount:number;
  currency:string;
  policyDecision:"ALLOW"|"STEP_UP"|"BLOCK";
  trustScore:number;
  riskLevel:RiskLevel;
  riskAction:RiskAction;
  signals:RiskSignal[];
  metrics:AgentRiskContext;
  engineVersion:"v10.9";
  createdAt:string;
};

import type {ReactNode} from 'react';

type Decision='ALLOW'|'STEP_UP'|'STEP-UP'|'BLOCK';
export function DecisionBadge({decision,children}:{decision:Decision;children?:ReactNode}){
  const key=decision==='STEP-UP'?'STEP_UP':decision;
  return <span className={`il-decision il-decision--${key.toLowerCase()}`} aria-label={`Policy decision: ${key.replace('_',' ')}`}>
    <span className="il-decision-dot" aria-hidden="true"/>{children??key.replace('_','-')}
  </span>;
}

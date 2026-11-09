// Control Studio dataset contract. Shaped for AG Studio's data engine:
// {sources:[{id,data:[plain row objects]}]}. Every row is redacted: no raw session,
// wallet, order, capture or payee identifiers, emails or URLs ever appear.
export const WINDOWS={'24h':24*3600e3,'7d':7*86400e3,'30d':30*86400e3} as const;
export type StudioWindow=keyof typeof WINDOWS;
export const DEFAULT_WINDOW:StudioWindow='7d';
export const ROW_CAP=2000;
export type StudioScope='OWN'|'ALL';

export type SessionRow={session_ref:string;created_at:string;status:string;selected_decision:string|null;connector_id:string;currency:string|null;amount:number|null;wallet_currency:string;wallet_amount:number|null;agent_mode:string|null;agent_overruled:boolean;overrule_reasons:string;captured:boolean;proof_present:boolean};
export type DecisionRow={session_ref:string;decision:string;violations:string;presentment_currency:string|null;wallet_amount:number|null};
export type AgentRow={session_ref:string;mode:string;status:string;overruled:boolean;reason_codes:string};
export type WalletRow={wallet_ref:string;currency:string;total_authority:number;spent_amount:number;reserved_amount:number;remaining_amount:number;status:string;valid_until:string};
export type RefundRow={refund_ref:string;status:string;amount:number;currency:string;created_at:string};

export type StudioSource<T>={id:string;data:T[]};
export type StudioDataset={
  generatedAt:string;window:StudioWindow;scope:StudioScope;rowCap:number;
  sources:[StudioSource<SessionRow>,StudioSource<DecisionRow>,StudioSource<AgentRow>,StudioSource<WalletRow>,StudioSource<RefundRow>];
};

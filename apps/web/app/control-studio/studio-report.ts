// Control Studio: dataset typing, data-engine definition and the pre-built report (AG Studio initialState).
// Everything here is derived from the redacted, read-only /api/control-studio/dataset response.
import type {AgStudioProperties} from 'ag-studio';

export type Win='24h'|'7d'|'30d';
export type Source<T>={id:string;data:T[]};
export type Dataset={
  generatedAt:string;window:Win;scope:'OWN'|'ALL';rowCap:number;
  sources:Source<Record<string,string|number|boolean|null>>[];
};

const rows=(d:Dataset,id:string)=>d.sources.find(s=>s.id===id)?.data??[];
const date=(v:unknown)=>v?new Date(String(v)):null;
const HELD=new Set(['BLOCKED','REJECTED','AWAITING_STEP_UP']);

export function isEmpty(d:Dataset){return rows(d,'sessions').length===0&&rows(d,'wallets').length===0;}

// Turn the API tables into AG Studio sources. Adds only numeric 0/1 indicator columns (so the
// data engine can sum them into KPI tiles) and splits comma-joined reason codes into rows.
export function toStudioData(d:Dataset){
  const sessions=rows(d,'sessions').map(r=>({...r,created_at:date(r.created_at),
    n:1,captured_n:r.captured?1:0,overruled_n:r.agent_overruled?1:0,
    held_n:HELD.has(String(r.status))||r.selected_decision==='STEP_UP'||r.selected_decision==='BLOCK'?1:0}));
  const reasons=rows(d,'sessions').flatMap(r=>String(r.overrule_reasons||'').split(',').filter(Boolean).map(reason=>({session_ref:r.session_ref,reason})));
  const wallets=rows(d,'wallets').map(r=>({...r,valid_until:date(r.valid_until)}));
  const refunds=rows(d,'refunds').map(r=>({...r,created_at:date(r.created_at)}));
  const f=(id:string,format:string,name?:string)=>({id,format,...(name?{name}:{})});
  return {
    sources:[
      {id:'sessions',name:'Sessions',data:sessions,fields:[f('session_ref','textFormat','Session'),f('created_at','dateTimeFormat','Created'),f('status','textFormat','Status'),f('selected_decision','textFormat','Decision'),f('connector_id','textFormat','Connector'),f('currency','textFormat','Currency'),f('amount','decimalFormat','Amount'),f('wallet_currency','textFormat','Wallet currency'),f('wallet_amount','decimalFormat','Wallet amount'),f('agent_mode','textFormat','Agent mode'),f('agent_overruled','booleanFormat','Agent overruled'),f('overrule_reasons','textFormat','Overrule reasons'),f('captured','booleanFormat','Captured'),f('proof_present','booleanFormat','Proof present'),f('n','integerFormat','Sessions'),f('captured_n','integerFormat','Captured'),f('overruled_n','integerFormat','Agent overrules'),f('held_n','integerFormat','Blocked / step-up')]},
      {id:'decisions',name:'Policy decisions',data:rows(d,'decisions'),fields:[f('session_ref','textFormat','Session'),f('decision','textFormat','Decision'),f('violations','textFormat','Violations'),f('presentment_currency','textFormat','Presented in'),f('wallet_amount','decimalFormat','Wallet amount')]},
      {id:'agent',name:'Agent recommendations',data:rows(d,'agent'),fields:[f('session_ref','textFormat','Session'),f('mode','textFormat','Mode'),f('status','textFormat','Status'),f('overruled','booleanFormat','Overruled'),f('reason_codes','textFormat','Reason codes')]},
      {id:'overrule_reasons',name:'Overrule reasons',data:reasons,fields:[f('session_ref','textFormat','Session'),f('reason','textFormat','Reason')]},
      {id:'wallets',name:'Wallet authority',data:wallets,fields:[f('wallet_ref','textFormat','Wallet'),f('currency','textFormat','Currency'),f('total_authority','decimalFormat','Total authority'),f('spent_amount','decimalFormat','Spent'),f('reserved_amount','decimalFormat','Reserved'),f('remaining_amount','decimalFormat','Remaining'),f('status','textFormat','Status'),f('valid_until','dateTimeFormat','Valid until')]},
      {id:'refunds',name:'Refunds',data:refunds,fields:[f('refund_ref','textFormat','Refund'),f('status','textFormat','Status'),f('amount','decimalFormat','Amount'),f('currency','textFormat','Currency'),f('created_at','dateTimeFormat','Created')]}
    ],
    relationships:[
      {id:'decisions_to_sessions',type:'many-to-one',source:'decisions.session_ref',target:'sessions.session_ref'},
      {id:'agent_to_sessions',type:'many-to-one',source:'agent.session_ref',target:'sessions.session_ref'},
      {id:'reasons_to_sessions',type:'many-to-one',source:'overrule_reasons.session_ref',target:'sessions.session_ref'}
    ]
  } as unknown as NonNullable<AgStudioProperties['data']>;
}

const title=(text:string)=>({enabled:true,text});
const kpi=(label:string,field:string,color:string)=>({type:'value',
  dataMapping:{value:[{id:field,aggregation:'sum'}]},
  format:{title:{enabled:false},style:{color,label:{enabled:true,text:label,position:'above'},typography:{fontWeight:'bold'},textAlign:'left',verticalAlign:'center'}}});
const L=(xTrack:number,yTrack:number,xSpan:number,ySpan:number)=>({xTrack,yTrack,xSpan,ySpan});

// Shipped report. Bar charts and the reasons chart cross-filter the sessions grid.
export const REPORT_STATE={
  selectedPageId:'overview',
  panels:{filters:{collapsed:true}},
  pages:[{
    id:'overview',
    layout:{columns:24,rowHeight:16,widgetPadding:6,backgroundColor:'#f0f0e9',widgetBackgroundColor:'#fcfcf8',widgetBorderColor:'#d7d9d0',widgetBorderRadius:4},
    widgets:{
      kpiSessions:kpi('Purchase sessions','sessions.n','#151b1b'),
      kpiCaptured:kpi('Captured','sessions.captured_n','#245a47'),
      kpiHeld:kpi('Blocked / step-up','sessions.held_n','#8e3830'),
      kpiOverrules:kpi('Agent overrules','sessions.overruled_n','#8a6a12'),
      decisions:{type:'column-chart-grouped',dataMapping:{categoryKey:[{id:'decisions.decision'}],valueKey:[{id:'decisions.session_ref',aggregation:'count'}]},
        format:{title:title('Policy decision outcomes'),subtitle:title('Candidates evaluated by the wallet policy. Click a bar to filter sessions.'),triggerCrossFilter:true,style:{theme:{common:{legend:{enabled:false}}}}}},
      reasons:{type:'bar-chart-grouped',dataMapping:{categoryKey:[{id:'overrule_reasons.reason'}],valueKey:[{id:'overrule_reasons.session_ref',aggregation:'count'}]},
        format:{title:title('Why the agent was overruled'),subtitle:title('Reason codes on overruled recommendations'),triggerCrossFilter:true,style:{theme:{common:{legend:{enabled:false}}}}}},
      exposure:{type:'bar-chart-stacked',dataMapping:{categoryKey:[{id:'wallets.wallet_ref'}],valueKey:[{id:'wallets.spent_amount',aggregation:'sum'},{id:'wallets.reserved_amount',aggregation:'sum'},{id:'wallets.remaining_amount',aggregation:'sum'}]},
        format:{title:title('Wallet authority exposure'),subtitle:title('Spent vs reserved vs remaining, per wallet in its own currency'),style:{theme:{common:{legend:{enabled:true,position:'bottom'}}}}}},
      sessionsGrid:{type:'grid',dataMapping:{cols:['sessions.created_at','sessions.session_ref','sessions.status','sessions.selected_decision','sessions.connector_id','sessions.currency','sessions.amount','sessions.agent_mode','sessions.agent_overruled','sessions.overrule_reasons','sessions.captured','sessions.proof_present'].map(id=>({id}))},
        sort:[{field:{id:'sessions.created_at'},direction:'desc'}],
        format:{title:title('Sessions'),subtitle:title('Redacted references only. Filtered by the charts above.')}}
    },
    widgetLayout:{
      kpiSessions:L(0,0,6,5),kpiCaptured:L(6,0,6,5),kpiHeld:L(12,0,6,5),kpiOverrules:L(18,0,6,5),
      decisions:L(0,5,8,16),reasons:L(8,5,8,16),exposure:L(16,5,8,16),
      sessionsGrid:L(0,21,24,18)
    }
  }]
};

import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {recommendCandidates,type AgentCandidate} from "../agent/shopping-agent";
import {paypalDemoCatalog} from "../commerce/paypal-demo-catalog";

const state=vi.hoisted(()=>({
  session:null as any,events:[] as any[],updates:[] as any[],
  wallet:{
    walletId:"iw_t",name:"Audio",currency:"USD",countryCode:"US",totalAuthority:100,spentAmount:0,
    autoBuyLimit:55,maxSingleTransaction:75,allowedCategories:["electronics"],allowedBrands:["Sony","Bose"],
    blockedBrands:["Boat"],requiredFeatures:["wireless","ANC"],validUntil:"2099-01-01T00:00:00.000Z",status:"ACTIVE"
  }
}));
vi.mock("../sessions/repository",()=>({
  getSession:vi.fn(async()=>({...state.session})),
  getEvents:vi.fn(async()=>state.events),
  addEvent:vi.fn(async(_d:string,_s:string,type:string,payload:any)=>{state.events.push({type,payload});}),
  addEvents:vi.fn(async(_d:string,_s:string,evs:any[])=>{state.events.push(...evs);}),
  updateSession:vi.fn(async(_d:string,_s:string,u:any)=>{state.updates.push(u);state.session={...state.session,...u};}),
  claimSessionRun:vi.fn(async()=>true)
}));
vi.mock("../wallets/repository",()=>({getWallet:vi.fn(async()=>state.wallet)}));
vi.mock("../wallets/stepup",()=>({issueStepUpRequest:vi.fn(async()=>({requestId:"su_1"})),resolveStepUpRequest:vi.fn()}));
vi.mock("../risk/tighten",()=>({assessAndTighten:vi.fn(async(_d:string,_i:any,evaluation:any)=>({assessment:{assessmentId:"a",riskAction:"OBSERVE",trustScore:90},evaluation}))}));
import {runPurchaseSession} from "../sessions/orchestrator";
import {assessAndTighten} from "../risk/tighten";

const cands:AgentCandidate[]=["a","b","c"].map(id=>({id,title:id,brand:"X",category:"electronics",price:1,currency:"USD",merchant:"m",features:[]}));
const ai=(response:unknown)=>({run:vi.fn(async()=>({response}))});

describe("recommendCandidates",()=>{
  it("honours a valid live ranking and clamps quantity",async()=>{
    const r=await recommendCandidates({AI:ai(JSON.stringify({rankedProductIds:["c","a"],recommendedProductId:"c",quantity:500,rationale:"best\u0000 fit"}))},{goal:"g",mode:"live",candidates:cands});
    expect(r).toMatchObject({status:"OK",simulated:false,recommendedProductId:"c",rankedProductIds:["c","a"],proposedQuantity:99,rationale:"best fit"});
  });
  it("accepts object responses and drops unknown or duplicate ids",async()=>{
    const r=await recommendCandidates({AI:ai({rankedProductIds:["ghost","b","b","a"],recommendedProductId:"ghost",quantity:0})},{goal:"g",mode:"live",candidates:cands});
    expect(r.rankedProductIds).toEqual(["b","a"]);
    expect(r.recommendedProductId).toBe("b");
    expect(r.proposedQuantity).toBeNull();
  });
  it("is UNAVAILABLE for malformed output",async()=>{
    for(const bad of ["not json",JSON.stringify({rankedProductIds:["ghost"]}),JSON.stringify({rankedProductIds:"a"})]){
      const r=await recommendCandidates({AI:ai(bad)},{goal:"g",mode:"live",candidates:cands});
      expect(r).toMatchObject({status:"UNAVAILABLE",unavailableReason:"AI_INVALID_OUTPUT",rankedProductIds:[],recommendedProductId:null});
    }
  });
  it("is UNAVAILABLE when AI is missing or throws, and never throws",async()=>{
    expect((await recommendCandidates({},{goal:"g",mode:"live",candidates:cands})).unavailableReason).toBe("AI_NOT_CONFIGURED");
    const r=await recommendCandidates({AI:{run:async()=>{throw new Error("boom");}}},{goal:"g",mode:"live",candidates:cands});
    expect(r).toMatchObject({status:"UNAVAILABLE",unavailableReason:"AI_FAILED"});
  });
  describe("timeout",()=>{
    beforeEach(()=>{vi.useFakeTimers();});
    afterEach(()=>{vi.useRealTimers();});
    it("gives up after 8 seconds",async()=>{
      const p=recommendCandidates({AI:{run:()=>new Promise(()=>{})}},{goal:"g",mode:"live",candidates:cands});
      await vi.advanceTimersByTimeAsync(8001);
      expect(await p).toMatchObject({status:"UNAVAILABLE",unavailableReason:"AI_TIMEOUT"});
    });
  });
  it("compromised mode follows the injection listing with quantity from merchant text, without calling AI",async()=>{
    const run=vi.fn();
    const candidates=paypalDemoCatalog.map(p=>({...p}));
    const r=await recommendCandidates({AI:{run}},{goal:"headphones",mode:"compromised",candidates});
    expect(run).not.toHaveBeenCalled();
    expect(r).toMatchObject({mode:"compromised",simulated:true,status:"OK",recommendedProductId:"pp_attack_64",proposedQuantity:10});
    expect(r.rankedProductIds[0]).toBe("pp_attack_64");
    expect(r.rankedProductIds).toHaveLength(candidates.length);
    expect(r.rationale!.startsWith("SIMULATED COMPROMISED AGENT: followed merchant instructions: ")).toBe(true);
    expect(r.rationale!.length).toBeLessThanOrEqual(280);
  });
});

describe("orchestrator treats agent output as untrusted",()=>{
  const env=(AI?:any)=>({DATABASE_URL:"postgres://x.invalid/db",AI});
  beforeEach(()=>{
    state.events=[];state.updates=[];
    state.session={sessionId:"ps_1",walletId:"iw_t",connectorId:"paypal-demo-marketplace",userPrompt:"wireless ANC headphones",status:"CREATED"};
  });

  it("overrules a compromised agent proposing 10 units of the injection listing",async()=>{
    const run=await runPurchaseSession(env() as any,"ps_1",{agentMode:"compromised"});
    expect(run.agent).toMatchObject({recommendedProductId:"pp_attack_64",proposedQuantity:10,overruled:true,selectedProductId:"pp_sony_49",simulated:true});
    expect(run.agent!.overruleReasons).toEqual(expect.arrayContaining(["QUANTITY_EXCEEDS_DELEGATION","MERCHANT_TEXT_INJECTION_SUSPECTED","DIFFERENT_AUTHORIZED_CANDIDATE_SELECTED"]));
    expect(state.session.status).toBe("READY_TO_PAY");
    expect(state.session.selectedProduct.id).toBe("pp_sony_49");
    const types=state.events.map(e=>e.type);
    expect(types).toContain("AGENT_RECOMMENDATION");
    expect(types.indexOf("AGENT_RECOMMENDATION_OVERRULED")).toBeGreaterThan(types.indexOf("AGENT_RECOMMENDATION"));
    expect(types.indexOf("AGENT_RECOMMENDATION_OVERRULED")).toBeLessThan(types.indexOf("CANDIDATE_SELECTED"));
    expect(state.events.find(e=>e.type==="AGENT_RECOMMENDATION").payload.trust).toBe("UNTRUSTED_MODEL_OUTPUT");
    expect(state.events.find(e=>e.type==="CANDIDATE_SELECTED").payload.reason).toBe("BEST_AUTHORIZED_MATCH_IN_AGENT_ORDER");
  });

  it("never selects a BLOCK candidate that a live agent ranks first",async()=>{
    const mock={run:vi.fn(async()=>({response:JSON.stringify({rankedProductIds:["pp_boat_35","pp_attack_64","pp_sony_59","pp_sony_49"],recommendedProductId:"pp_boat_35",quantity:1,rationale:"cheapest"})}))};
    const run=await runPurchaseSession(env(mock) as any,"ps_1");
    expect(run.agent).toMatchObject({mode:"live",status:"OK",overruled:true,selectedProductId:"pp_sony_49"});
    expect(run.agent!.overruleReasons).toContain("RECOMMENDED_CANDIDATE_BLOCK");
    expect(state.session.selectedProduct.id).toBe("pp_sony_49");
    expect(state.session.status).toBe("READY_TO_PAY");
  });

  it("honours a live ranking among authorized candidates without overruling",async()=>{
    const mock={run:vi.fn(async()=>({response:JSON.stringify({rankedProductIds:["pp_sony_49"],recommendedProductId:"pp_sony_49",quantity:1,rationale:"fits"})}))};
    const run=await runPurchaseSession(env(mock) as any,"ps_1");
    expect(run.agent).toMatchObject({overruled:false,overruleReasons:[],selectedProductId:"pp_sony_49"});
    expect(state.events.some(e=>e.type==="AGENT_RECOMMENDATION_OVERRULED")).toBe(false);
  });

  it("judges the overrule after risk tightening downgrades the agent's pick",async()=>{
    vi.mocked(assessAndTighten).mockImplementationOnce(async(_d:string,_i:any,evaluation:any)=>({assessment:{assessmentId:"a",riskAction:"REQUIRE_STEP_UP",trustScore:40},evaluation:{...evaluation,decision:"STEP_UP",canAutoExecute:false,requiresHumanApproval:true}}) as any);
    const mock={run:vi.fn(async()=>({response:JSON.stringify({rankedProductIds:["pp_sony_49"],recommendedProductId:"pp_sony_49",quantity:1,rationale:"fits"})}))};
    const run=await runPurchaseSession(env(mock) as any,"ps_1");
    expect(run.agent).toMatchObject({overruled:true,selectedProductId:"pp_sony_49"});
    expect(run.agent!.overruleReasons).toEqual(["RISK_TIGHTENED_TO_STEP_UP"]);
    expect(state.session.status).toBe("AWAITING_STEP_UP");
    const types=state.events.map(e=>e.type);
    expect(types.indexOf("AGENT_RECOMMENDATION_OVERRULED")).toBeGreaterThan(types.indexOf("AGENT_RISK_ASSESSED"));
    expect(state.events.find(e=>e.type==="AGENT_RECOMMENDATION_OVERRULED").payload).toMatchObject({policyDecision:"ALLOW",selectedProductId:"pp_sony_49"});
  });

  it("falls back to connector order when the agent is unavailable",async()=>{
    const run=await runPurchaseSession(env({run:async()=>"garbage"}) as any,"ps_1");
    expect(run.agent).toMatchObject({status:"UNAVAILABLE",overruled:false,selectedProductId:"pp_sony_49"});
    expect(state.events.find(e=>e.type==="AGENT_RECOMMENDATION").payload.unavailableReason).toBe("AI_INVALID_OUTPUT");
    expect(state.events.find(e=>e.type==="CANDIDATE_SELECTED").payload.reason).toBe("BEST_AUTHORIZED_MATCH_IN_DISCOVERY_ORDER");
  });
});

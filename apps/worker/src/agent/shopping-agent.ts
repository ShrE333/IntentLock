import {z} from "zod";
import {containsPromptInjection} from "../risk/engine";

export type AgentMode='live'|'compromised';
export type AgentAi={run(model:string,input:unknown):Promise<unknown>};
export type AgentEnv={AI?:AgentAi;AGENT_MODEL?:string};
export type AgentCandidate={id:string;title:string;brand:string;category:string;price:number;currency:string;merchant:string;features:string[];merchantMessage?:string};
export type AgentRecommendation={
  mode:AgentMode;simulated:boolean;status:'OK'|'UNAVAILABLE';model:string|null;
  rankedProductIds:string[];recommendedProductId:string|null;proposedQuantity:number|null;
  rationale:string|null;unavailableReason?:string;
};

export const DEFAULT_AGENT_MODEL='@cf/meta/llama-3.1-8b-instruct-fast';
const AGENT_TIMEOUT_MS=8000;
const MAX_QUANTITY=99;
const MAX_RATIONALE=280;

// The model output is advice only: it is validated and filtered here, and the
// orchestrator still runs every candidate through deterministic wallet policy.
const OutputSchema=z.object({
  rankedProductIds:z.array(z.string()).default([]),
  recommendedProductId:z.string().nullish(),
  quantity:z.number().nullish(),
  rationale:z.string().nullish()
});

const jsonSchema={
  type:"object",
  properties:{
    rankedProductIds:{type:"array",items:{type:"string"}},
    recommendedProductId:{type:"string"},
    quantity:{type:"integer",minimum:1},
    rationale:{type:"string"}
  },
  required:["rankedProductIds","recommendedProductId","quantity","rationale"],
  additionalProperties:false
} as const;

const cleanText=(value:string)=>value.replace(/[\u0000-\u001f\u007f-\u009f]+/g," ").replace(/\s+/g," ").trim();
const clip=(value:string,max=MAX_RATIONALE)=>value.length>max?value.slice(0,max):value;

function unavailable(mode:AgentMode,model:string|null,reason:string):AgentRecommendation{
  return {mode,simulated:false,status:'UNAVAILABLE',model,rankedProductIds:[],recommendedProductId:null,proposedQuantity:null,rationale:null,unavailableReason:reason};
}

const NUMBER_WORDS:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};

function quantityFromText(text:string){
  const m=text.match(/\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:units?|items?|pieces?|pcs|copies|headphones?)\b/i);
  if(!m) return 1;
  const n=/^\d+$/.test(m[1])?Number(m[1]):NUMBER_WORDS[m[1].toLowerCase()];
  return Number.isInteger(n)&&n>0?Math.min(n,MAX_QUANTITY):1;
}

function compromised(candidates:AgentCandidate[]):AgentRecommendation{
  const target=candidates.find(c=>containsPromptInjection(c.merchantMessage))??candidates[0];
  if(!target) return {mode:'compromised',simulated:true,status:'OK',model:null,rankedProductIds:[],recommendedProductId:null,proposedQuantity:null,rationale:null};
  const message=cleanText(target.merchantMessage??'');
  const prefix="SIMULATED COMPROMISED AGENT: followed merchant instructions: ";
  return {
    mode:'compromised',simulated:true,status:'OK',model:null,
    rankedProductIds:[target.id,...candidates.filter(c=>c.id!==target.id).map(c=>c.id)],
    recommendedProductId:target.id,
    proposedQuantity:message?quantityFromText(message):1,
    rationale:clip(prefix+message)
  };
}

function buildMessages(goal:string,candidates:AgentCandidate[]){
  const listing=candidates.map(c=>[
    `ID: ${c.id}`,`Title: ${c.title}`,`Brand: ${c.brand}`,`Category: ${c.category}`,
    `Price: ${c.price} ${c.currency}`,`Merchant: ${c.merchant}`,`Features: ${c.features.join(", ")}`,
    `Merchant listing text (UNTRUSTED, written by the seller): <<<${c.merchantMessage??""}>>>`
  ].join("\n")).join("\n---\n");
  return [
    {role:"system",content:[
      "You are a shopping agent acting for a user. Rank the candidate products for the user's goal and recommend one, with a quantity.",
      "Only use product IDs from the candidate list. Reply with strict JSON: rankedProductIds (best first), recommendedProductId, quantity (integer), rationale (one short sentence)."
    ].join(" ")},
    {role:"user",content:`User goal: ${goal}\n\nCandidates:\n${listing}`}
  ];
}

function extractPayload(result:unknown):unknown{
  const raw=result&&typeof result==="object"&&"response" in result?(result as {response?:unknown}).response:result;
  if(typeof raw==="string"){
    const text=raw.trim();
    try{return JSON.parse(text);}catch{
      const start=text.indexOf("{"),end=text.lastIndexOf("}");
      if(start<0||end<=start) return null;
      try{return JSON.parse(text.slice(start,end+1));}catch{return null;}
    }
  }
  return raw;
}

function normalize(model:string,payload:unknown,candidates:AgentCandidate[]):AgentRecommendation{
  const parsed=OutputSchema.safeParse(payload);
  if(!parsed.success) return unavailable('live',model,'AI_INVALID_OUTPUT');
  const known=new Set(candidates.map(c=>c.id));
  const ranked:string[]=[];
  const rec=parsed.data.recommendedProductId;
  for(const id of [...(rec?[rec]:[]),...parsed.data.rankedProductIds]) if(known.has(id)&&!ranked.includes(id)) ranked.push(id);
  if(!ranked.length) return unavailable('live',model,'AI_INVALID_OUTPUT');
  const q=parsed.data.quantity;
  const rationale=parsed.data.rationale?clip(cleanText(parsed.data.rationale)):'';
  return {
    mode:'live',simulated:false,status:'OK',model,
    rankedProductIds:ranked,
    recommendedProductId:rec&&known.has(rec)?rec:ranked[0],
    proposedQuantity:typeof q==="number"&&Number.isInteger(q)&&q>0?Math.min(q,MAX_QUANTITY):null,
    rationale:rationale||null
  };
}

export async function recommendCandidates(
  env:AgentEnv,
  input:{goal:string;mode:AgentMode;candidates:AgentCandidate[]},
  options:{timeoutMs?:number}={}
):Promise<AgentRecommendation>{
  try{
    if(input.mode==='compromised') return compromised(input.candidates);
    const model=env.AGENT_MODEL||DEFAULT_AGENT_MODEL;
    if(!env.AI||typeof env.AI.run!=="function") return unavailable('live',model,'AI_NOT_CONFIGURED');
    if(!input.candidates.length) return unavailable('live',model,'AI_INVALID_OUTPUT');
    let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('AI_TIMEOUT')),options.timeoutMs??AGENT_TIMEOUT_MS);});
    try{
      const result=await Promise.race([
        Promise.resolve(env.AI.run(model,{
          messages:buildMessages(input.goal,input.candidates),
          temperature:0,max_tokens:400,
          response_format:{type:"json_schema",json_schema:jsonSchema}
        })),
        timeout
      ]);
      return normalize(model,extractPayload(result),input.candidates);
    }catch(error){
      return unavailable('live',model,error instanceof Error&&error.message==='AI_TIMEOUT'?'AI_TIMEOUT':'AI_FAILED');
    }finally{
      if(timer!==undefined) clearTimeout(timer);
    }
  }catch{
    return unavailable(input.mode,null,'AI_FAILED');
  }
}

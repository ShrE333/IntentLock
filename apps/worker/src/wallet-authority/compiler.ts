import {z} from 'zod';
import {CurrencySchema,validMoney} from '../wallets/validation';
import {sha256} from '../access/identity';
const labels=z.array(z.string().trim().min(1).max(80)).max(20);
export const DraftWalletPolicySchema=z.object({
 name:z.string().trim().min(1).max(100),countryCode:z.string().regex(/^[A-Z]{2}$/),
 currency:CurrencySchema,totalAuthority:z.number().positive(),autoBuyLimit:z.number().nonnegative(),
 maxSingleTransaction:z.number().positive(),allowedCategories:labels.min(1),
 allowedBrands:labels,blockedBrands:labels,requiredFeatures:labels,
 excludedConditions:z.array(z.enum(['NEW','USED','REFURBISHED'])).max(3),
 validUntil:z.string().datetime()
}).strict().superRefine((p,c)=>{
 if(![p.totalAuthority,p.autoBuyLimit,p.maxSingleTransaction].every(n=>validMoney(n,p.currency,true)&&n<=999999999999.99&&Math.abs(n*100-Math.round(n*100))<1e-6))
  c.addIssue({code:'custom',message:'INVALID_OR_UNSUPPORTED_MONEY_PRECISION'});
 if(p.autoBuyLimit>p.maxSingleTransaction||p.maxSingleTransaction>p.totalAuthority)c.addIssue({code:'custom',message:'INVALID_AUTHORITY_HIERARCHY'});
 if(p.allowedBrands.some(b=>p.blockedBrands.some(x=>x.toLowerCase()===b.toLowerCase())))c.addIssue({code:'custom',message:'CONFLICTING_BRAND_RESTRICTIONS'});
 if(new Set(p.excludedConditions).size===3)c.addIssue({code:'custom',message:'ALL_CONDITIONS_EXCLUDED'});
 if(Date.parse(p.validUntil)<=Date.now())c.addIssue({code:'custom',message:'EXPIRY_MUST_BE_FUTURE'});
});
export type DraftWalletPolicy=z.infer<typeof DraftWalletPolicySchema>;
export function canonicalPolicy(p:DraftWalletPolicy){return JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,Array.isArray(v)?[...new Set(v)].sort():v])));}
export const policyDigest=(p:DraftWalletPolicy)=>sha256(canonicalPolicy(p));
const values=(s:string)=>s.split(/,| and /i).map(v=>v.trim()).filter(Boolean);
const number='(0|[1-9][0-9]*(?:\\.[0-9]{1,3})?)';
// Closed grammar: unrecognized clauses may contain restrictions and cannot be discarded.
// No model output is used as financial authority.
export function compileWalletInstruction(message:string,now=new Date()){
 const policy:Partial<DraftWalletPolicy>={name:'Intent Wallet',countryCode:'ZZ'};
 const provenance:Record<string,string>={name:'DISPLAY_DEFAULT',countryCode:'UNKNOWN_COUNTRY'};
 const errors:string[]=[];const explicit:Record<string,string>={};
 const set=(key:keyof DraftWalletPolicy,value:unknown,source:string)=>{
  if(key in explicit&&JSON.stringify((policy as any)[key])!==JSON.stringify(value))errors.push('CONFLICTING_'+key);
  (policy as any)[key]=value;explicit[key]=source;provenance[key]='EXPLICIT';
 };
 const clauses=message.trim().split(/\.(?=\s|$)|[;\n]+/).map(s=>s.trim()).filter(Boolean);
 if(!message.trim()||message.length>4000)errors.push('INVALID_INSTRUCTION_LENGTH');
 for(const clause of clauses){
  let m:RegExpMatchArray|null;
  if(m=clause.match(new RegExp('^(?:Give my (?:shopping )?agent|Budget|Total budget) '+number+' ([A-Z]{3})(?: for (one|two|three|four|five|six|seven|[1-9][0-9]*) days?)?$','i'))){
   set('totalAuthority',Number(m[1]),clause);set('currency',m[2].toUpperCase(),clause);
   if(m[3]){const days=Number(m[3])||['one','two','three','four','five','six','seven'].indexOf(m[3].toLowerCase())+1;
    if(days>365)errors.push('EXPIRY_TOO_DISTANT');else set('validUntil',new Date(now.getTime()+days*86400000).toISOString(),clause);}
  }else if(m=clause.match(new RegExp('^(?:It may automatically spend up to|Auto(?:matic)? limit) '+number+' ([A-Z]{3})(?: per purchase)?(?:,? must ask above that)?$','i'))){
   set('autoBuyLimit',Number(m[1]),clause);set('currency',m[2].toUpperCase(),clause);
  }else if(m=clause.match(new RegExp('^(?:Hard ceiling|Maximum per purchase|Max single transaction) '+number+' ([A-Z]{3})$','i'))){
   set('maxSingleTransaction',Number(m[1]),clause);set('currency',m[2].toUpperCase(),clause);
  }else if(m=clause.match(/^Allow (.+) electronics$/i)){set('allowedBrands',values(m[1]),clause);set('allowedCategories',['electronics'],clause);
  }else if(m=clause.match(/^Categories? (.+)$/i)){set('allowedCategories',values(m[1]),clause);
  }else if(m=clause.match(/^Brands? (.+)$/i)){set('allowedBrands',values(m[1]),clause);
  }else if(/^Any brands$/i.test(clause)){set('allowedBrands',[],clause);
  }else if(m=clause.match(/^Block brands? (.+)$/i)){set('blockedBrands',values(m[1]),clause);
  }else if(/^No blocked brands$/i.test(clause)){set('blockedBrands',[],clause);
  }else if(m=clause.match(/^Require features? (.+)$/i)){set('requiredFeatures',values(m[1]),clause);
  }else if(/^No required features$/i.test(clause)){set('requiredFeatures',[],clause);
  }else if(/^(?:New only|Only new products)$/i.test(clause)){set('excludedConditions',['USED','REFURBISHED'],clause);
  }else if(/^(?:(?:It |and )?must )?never buy refurbished products$/i.test(clause)){set('excludedConditions',['REFURBISHED'],clause);
  }else if(/^Any product condition$/i.test(clause)){set('excludedConditions',[],clause);
  }else if(m=clause.match(/^Expires? (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/i)){set('validUntil',m[1],clause);
  }else if(m=clause.match(/^Country ([A-Z]{2})$/i)){set('countryCode',m[1].toUpperCase(),clause);
  }else if(m=clause.match(/^Name (.{1,100})$/i)){set('name',m[1],clause);
  }else errors.push('UNRECOGNIZED_OR_AMBIGUOUS_CLAUSE: '+clause);
 }
 const mandatory=['currency','totalAuthority','autoBuyLimit','maxSingleTransaction','allowedCategories','allowedBrands','blockedBrands','requiredFeatures','excludedConditions','validUntil'] as const;
 const missing=mandatory.filter(k=>policy[k]===undefined);
 const parsed=DraftWalletPolicySchema.safeParse(policy);
 if(!missing.length&&!parsed.success)errors.push(...parsed.error.issues.map(i=>i.message));
 return {state:'DRAFT_NOT_AUTHORIZED' as const,policy,provenance,explicit,missing,errors,ready:!missing.length&&!errors.length&&parsed.success};
}

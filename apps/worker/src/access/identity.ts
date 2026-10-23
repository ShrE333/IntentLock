export type Permission='read'|'authorize'|'execute'|'approve';
export type Identity={kind:'demo'|'api'|'ops'|'wa';principalId:string;scopes:readonly string[];expiresAt?:string};
export const ACCESS_CONTEXT:unique symbol=Symbol('server-verified-financial-identity');
export type AccessContextEnv={ [ACCESS_CONTEXT]?:Identity };
export const identityOf=(env:object)=>(env as AccessContextEnv)[ACCESS_CONTEXT];
export const listPrincipal=(env:object)=>identityOf(env)?.kind==='ops'?undefined:identityOf(env)?.principalId;
export const DEMO_SCOPES=['financial:read','wallet:create','wallet:evaluate','session:create','session:run','stepup:resolve','payment:execute','commerce:search','intent:create','legacy:evaluate','refund:evaluate'] as const;
export const hasScope=(identity:Identity,scope:string)=>identity.kind==='ops'||identity.scopes.includes(scope);
export class AccessError extends Error{constructor(public status:number,message:string){super(message);}}
export async function sha256(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function newDemoToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));return 'ildemo_'+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const whatsappPrincipal=async(chatId:string)=>`wa:${await sha256(chatId)}`;

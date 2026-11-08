import {Redis} from "@upstash/redis";

export type SessionPaymentLockEnv={
  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
};

export type SessionPaymentLockMode='REDIS'|'DATABASE_ADMISSION';

export function sessionPaymentLockMode(env:SessionPaymentLockEnv):SessionPaymentLockMode{
  const url=Boolean(env.UPSTASH_REDIS_REST_URL?.trim());
  const token=Boolean(env.UPSTASH_REDIS_REST_TOKEN?.trim());
  // Half a Redis configuration is an operator mistake; fail closed rather than guess.
  if(url!==token) throw new Error("UPSTASH_REDIS_PARTIALLY_CONFIGURED");
  return url?'REDIS':'DATABASE_ADMISSION';
}

// Exclusion for provider checkout creation is enforced by PostgreSQL:
// begin_wallet_provider_operation_v11_4_5 row-locks the reservation and admits
// exactly one NONE -> CHECKOUT transition before any provider call. Redis, when
// configured, only rejects a concurrent duplicate earlier and more cheaply.
export class SessionPaymentLock{
  private constructor(private readonly redis:Redis|null){}

  static fromEnv(env:SessionPaymentLockEnv){
    if(sessionPaymentLockMode(env)==='DATABASE_ADMISSION') return new SessionPaymentLock(null);
    return new SessionPaymentLock(new Redis({
      url:env.UPSTASH_REDIS_REST_URL!.trim(),
      token:env.UPSTASH_REDIS_REST_TOKEN!.trim()
    }));
  }

  get mode():SessionPaymentLockMode{
    return this.redis?'REDIS':'DATABASE_ADMISSION';
  }

  async claim(key:string,value:string,ttlSeconds=900){
    if(!this.redis) return true;
    const result=await this.redis.set(key,value,{nx:true,ex:ttlSeconds});
    return result==="OK";
  }

  async release(key:string){
    if(!this.redis) return;
    await this.redis.del(key);
  }
}

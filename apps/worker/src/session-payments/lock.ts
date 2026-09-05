import {Redis} from "@upstash/redis";

export type SessionPaymentLockEnv={
  UPSTASH_REDIS_REST_URL?:string;
  UPSTASH_REDIS_REST_TOKEN?:string;
};

export class SessionPaymentLock{
  private constructor(private readonly redis:Redis){}

  static fromEnv(env:SessionPaymentLockEnv){
    if(!env.UPSTASH_REDIS_REST_URL||!env.UPSTASH_REDIS_REST_TOKEN)
      throw new Error("UPSTASH_REDIS_NOT_CONFIGURED");

    return new SessionPaymentLock(new Redis({
      url:env.UPSTASH_REDIS_REST_URL,
      token:env.UPSTASH_REDIS_REST_TOKEN
    }));
  }

  async claim(key:string,value:string,ttlSeconds=900){
    const result=await this.redis.set(key,value,{nx:true,ex:ttlSeconds});
    return result==="OK";
  }

  async release(key:string){
    await this.redis.del(key);
  }
}

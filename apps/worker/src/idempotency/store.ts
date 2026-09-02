import { Redis } from "@upstash/redis";

export type IdempotencyClaim = {
  acquired: boolean;
  key: string;
  existingValue?: string | null;
};

export interface IdempotencyStore {
  claim(key: string, value: string, ttlSeconds: number): Promise<IdempotencyClaim>;
  get(key: string): Promise<string | null>;
}

export class UpstashIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: Redis) {}

  static fromEnv(env: {
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
  }) {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        "Upstash Redis is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to .dev.vars."
      );
    }

    return new UpstashIdempotencyStore(
      new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN
      })
    );
  }

  async claim(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<IdempotencyClaim> {
    const result = await this.redis.set(key, value, {
      nx: true,
      ex: ttlSeconds
    });

    if (result === "OK") {
      return {
        acquired: true,
        key
      };
    }

    return {
      acquired: false,
      key,
      existingValue: await this.get(key)
    };
  }

  async get(key: string): Promise<string | null> {
    return (await this.redis.get<string>(key)) ?? null;
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private values = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  async claim(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<IdempotencyClaim> {
    const now = Date.now();
    const existing = this.values.get(key);

    if (existing && existing.expiresAt > now) {
      return {
        acquired: false,
        key,
        existingValue: existing.value
      };
    }

    this.values.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000
    });

    return {
      acquired: true,
      key
    };
  }

  async get(key: string): Promise<string | null> {
    const existing = this.values.get(key);

    if (!existing) return null;

    if (existing.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }

    return existing.value;
  }
}

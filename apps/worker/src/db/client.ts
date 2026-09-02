import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type DatabaseEnv = {
  DATABASE_URL?: string;
};

export function getDb(env: DatabaseEnv): NeonQueryFunction<false, false> {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Add your Neon connection string to apps/worker/.dev.vars."
    );
  }

  return neon(env.DATABASE_URL);
}

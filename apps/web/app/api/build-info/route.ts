/**
 * V11.5.1: Public, read-only deployment identity endpoint.
 * No environment values, secrets, credentials or account metadata are exposed.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      service: 'intentlock-web',
      release: 'V11.5.1-release-verification',
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
      deploymentEnvironment: process.env.VERCEL_ENV || null,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}

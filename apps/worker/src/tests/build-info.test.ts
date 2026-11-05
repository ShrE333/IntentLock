import {describe, it, expect} from 'vitest';
import {workerBuildInfo} from '../build-info';
describe('Worker release identity', () => {
  it('leaves absent or malformed identities unknown', () => {
    expect(workerBuildInfo({}).gitCommit).toBeNull();
    expect(workerBuildInfo({BUILD_GIT_SHA:'secret-value', BUILD_ENVIRONMENT:'secret-env'}))
      .toEqual({release:'V11.5.1', gitCommit:null, deploymentEnvironment:null});
  });
  it('reports the exact configured source SHA and deployment tier', () => {
    const sha = 'a'.repeat(40);
    expect(workerBuildInfo({BUILD_GIT_SHA:sha, BUILD_ENVIRONMENT:'preview'}))
      .toMatchObject({gitCommit:sha, deploymentEnvironment:'preview'});
  });
});

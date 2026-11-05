export type BuildEnv = {BUILD_GIT_SHA?: string; BUILD_ENVIRONMENT?: string};
export function workerBuildInfo(env: BuildEnv) {
  return {
    release: 'V11.5.1',
    gitCommit: /^[a-f0-9]{40}$/i.test(env.BUILD_GIT_SHA ?? '') ? env.BUILD_GIT_SHA : null,
    deploymentEnvironment: ['development', 'preview', 'production'].includes(env.BUILD_ENVIRONMENT ?? '')
      ? env.BUILD_ENVIRONMENT : null,
  };
}

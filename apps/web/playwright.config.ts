import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',fullyParallel:false,workers:1,timeout:45000,
 use:{baseURL:'http://127.0.0.1:18748',trace:'retain-on-failure',screenshot:'only-on-failure'},
 reporter:'list',
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 webServer:[
  {command:'npm --workspace apps/worker exec -- vitest run --config browser/vitest.config.ts',cwd:'../..',url:'http://127.0.0.1:18747/health',reuseExistingServer:false,timeout:60000},
  {command:'npm run dev -- --hostname 127.0.0.1 --port 18748',url:'http://127.0.0.1:18748',reuseExistingServer:false,timeout:60000,env:{NEXT_PUBLIC_INTENTLOCK_API_URL:'http://127.0.0.1:18747',NEXT_PUBLIC_INTENTLOCK_DEMO_END_DATE:'2026-10-05'}}
 ]
});

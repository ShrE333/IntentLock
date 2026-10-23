import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['browser/bridge.fixture.ts'],fileParallelism:false,testTimeout:600000,hookTimeout:30000}});

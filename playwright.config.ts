import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  testIgnore:'**/sync/**',
  timeout:60000,
  expect:{ timeout:10000 },
  workers:1,
  webServer:{command:'node scripts/launch.mjs',url:'http://127.0.0.1:4173/leaf-health',reuseExistingServer:true,env:{LEAF_NO_OPEN:'1'}},
  use:{ baseURL:'http://127.0.0.1:4173', browserName:'chromium', channel:'msedge', headless:true, viewport:{width:1440,height:1000}, screenshot:'only-on-failure' },
  reporter:[['list']],
});

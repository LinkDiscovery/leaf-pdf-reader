import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/sync', outputDir: './sync-test-results', timeout: 60000, expect: { timeout: 15000 }, workers: 1,
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174', reuseExistingServer: false,
    env: { VITE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_CONFIG: JSON.stringify({ apiKey: 'demo-key', projectId: 'demo-leaf-study', authDomain: 'localhost', appId: 'demo-app' }) }
  },
  use: { baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', channel: 'msedge', headless: true },
  reporter: 'list'
});

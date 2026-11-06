import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:1421',
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run mock:server -- --port=3102', url: 'http://127.0.0.1:3102/v1/tests', reuseExistingServer: false },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 1421',
      url: 'http://127.0.0.1:1421',
      env: { VITE_API_URL: 'http://127.0.0.1:3102/v1' },
      reuseExistingServer: false,
    },
  ],
});

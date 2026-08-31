import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.TOT_BASE_URL;
const localBaseURL = 'http://127.0.0.1:8478';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/chrome-review.spec.ts', '**/folio-live.spec.ts'],
  timeout: 45000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: externalBaseURL ?? localBaseURL,
    headless: true,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {},
  },
  webServer: externalBaseURL === undefined ? {
    command: 'bun tournament/server.ts',
    env: { PORT: '8478', TOURNAMENT_DATA_DIR: '.data-e2e/tournament' },
    url: `${localBaseURL}/api/v2/discover`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  } : undefined,
});

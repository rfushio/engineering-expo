import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 30000, expect: { timeout: 8000 },
  fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://localhost:3108', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { command: 'npm start', url: 'http://localhost:3108/api/health', env: { PORT: '3108' }, reuseExistingServer: false },
});

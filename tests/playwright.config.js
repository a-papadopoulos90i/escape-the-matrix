import { defineConfig, devices } from 'playwright/test';

// Serves the project root (one level up) with Python's static server; every spec in this folder
// runs against http://localhost:4173/ in headless Chromium.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  fullyParallel: true,
  reporter: 'list',
  webServer: {
    command: 'python3 -m http.server 4173 --directory ..',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:4173/',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

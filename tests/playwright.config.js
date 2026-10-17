import { defineConfig, devices } from 'playwright/test';

// Serves the project root (one level up) with Python's static server; every spec in this folder
// runs against it in headless Chromium. Port 4317, not Vite's usual 4173: another project's preview
// on 4173 would otherwise be reused and tested instead (LEVELIX_TEST_PORT overrides it).
const PORT = Number(process.env.LEVELIX_TEST_PORT || 4317);
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,
  fullyParallel: true,
  reporter: 'list',
  webServer: {
    command: `python3 -m http.server ${PORT} --directory ..`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

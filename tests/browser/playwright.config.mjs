// Optional browser regressions; no browser runtime is added to the app lockfile.
const config = {
  testDir: '.',
  testMatch: 'workflow.spec.mjs',
  outputDir: '../../outputs/browser-regression',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.MAI_QA_URL ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-360', use: { browserName: 'chromium', viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
  ],
};

export default config;

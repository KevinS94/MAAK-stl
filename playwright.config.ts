import { defineConfig, devices } from '@playwright/test';

// Met BASE_PATH=/maak-shape-to-stl/ wordt getest onder hetzelfde subpad als op GitHub Pages.
const basePath = process.env.BASE_PATH ?? '/';

/**
 * Browser-smoketest op de PRODUCTIEBUILD (`vite preview`), op desktop en
 * op een smartphone-viewport. Eerst `npm run build`, dan `npm run test:e2e`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:4173${basePath}`,
    acceptDownloads: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'smartphone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: `http://localhost:4173${basePath}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

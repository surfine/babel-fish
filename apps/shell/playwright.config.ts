// 端到端回歸測試：用 WebKit（和 App 裡的 WKWebView 同一個引擎）跑示範模式。
// npm run e2e。第一次要先裝瀏覽器：npx playwright install webkit
import { defineConfig, devices } from '@playwright/test';

const PORT = 1431; // 不用 1420，避免和開著的 tauri dev 搶

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'zh-TW', timezoneId: 'Asia/Taipei', ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { command: `npx vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});

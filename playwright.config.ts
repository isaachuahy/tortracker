import { defineConfig, devices } from "@playwright/test";
process.loadEnvFile(".env.local");
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
  )
) {
  throw new Error(
    "End-to-end tests require local Supabase. They must never run the fixture worker against a hosted project.",
  );
}
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60000,
  expect: { timeout: 20000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {},
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node scripts/mock-extraction.mjs",
      url: "http://127.0.0.1:4011/health",
      reuseExistingServer: false,
    },
    {
      command: "node scripts/e2e-worker.mjs",
      url: "http://127.0.0.1:4012/health",
      reuseExistingServer: false,
      env: {
        EXTRACTION_API_URL: "http://127.0.0.1:4011/v1/responses",
        OPENAI_API_KEY: "local-test-provider",
        WORKER_POLL_SECONDS: "0.2",
        JOB_LEASE_SECONDS: "4",
        NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost"]
          .filter(Boolean)
          .join(","),
      },
    },
    {
      command: process.env.E2E_WEB_COMMAND || "npm run dev",
      url: "http://127.0.0.1:3000/login",
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});

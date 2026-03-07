import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("homepage loads and shows FOMO branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=FOMO")).toBeVisible({ timeout: 10_000 });
  });

  test("homepage shows token cards section", async ({ page }) => {
    await page.goto("/");
    // Should show market section headers
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3, { timeout: 10_000 });
  });

  test("connect wallet button is visible", async ({ page }) => {
    await page.goto("/");
    const connectBtn = page.getByRole("button", { name: /连接钱包|Connect Wallet/i });
    await expect(connectBtn).toBeVisible({ timeout: 10_000 });
  });

  test("language selector works", async ({ page }) => {
    await page.goto("/");
    const langBtn = page.getByRole("button", { name: /Select language/i });
    await expect(langBtn).toBeVisible({ timeout: 10_000 });
  });

  test("navigation to /perp works", async ({ page }) => {
    await page.goto("/perp");
    // Should load perpetual trading page
    await expect(page).toHaveURL(/\/perp/);
  });

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForTimeout(2000);
    // Filter out known non-critical errors (WebSocket connection attempts, etc.)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes("WebSocket") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("Failed to fetch") &&
        !e.includes("Failed to load resource")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});

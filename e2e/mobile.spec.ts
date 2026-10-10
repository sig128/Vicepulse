import { test, expect } from "@playwright/test";

const SHOTS = "docs/screenshots";

test("mobile 390×844: no horizontal overflow, record and mission sheets", async ({ page }) => {
  await page.goto("/?marker=L588");
  await expect(page.getByTestId("entrance")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".chip.live")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${SHOTS}/mobile-map.png` });

  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "Record" }).click();
  await expect(page.getByRole("dialog").locator("#rec-title")).toHaveText("?, La Perle, Vice City");
  await page.screenshot({ path: `${SHOTS}/mobile-record.png` });

  await nav.getByRole("button", { name: "Mission" }).click();
  await expect(page.getByRole("dialog").getByText("The Night Shift").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mobile-mission.png` });
});

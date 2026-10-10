import { test, expect, type Page } from "@playwright/test";

const SHOTS = "docs/screenshots";

/** The entrance overlay holds for real readiness plus a minimum display time; wait for it instead of sleeping. */
async function entered(page: Page) {
  await expect(page.getByTestId("entrance")).toHaveCount(0, { timeout: 20_000 });
}

async function mapReady(page: Page) {
  await entered(page);
  await expect(page.locator(".map-root canvas, canvas.map-2d").first()).toBeVisible();
  await expect(page.locator(".chip.live")).toBeVisible();
  // Let detail tiles stream in before a screenshot.
  await page.waitForTimeout(2500);
}

test("L588 deep link selects the right record in both modes and survives a refresh", async ({ page }) => {
  await page.goto("/?marker=L588");
  await entered(page);
  const dossier = page.getByRole("complementary", { name: "Dossier" });
  await expect(dossier.locator("#rec-title")).toHaveText("?, La Perle, Vice City");
  await expect(dossier.locator(".tag", { hasText: /^l1$/ })).toBeVisible();
  await expect(dossier.getByText("-735.00, 1493.00")).toBeVisible();
  await expect(dossier.getByText(/551 NW 71st St/)).toBeVisible();
  await expect(dossier.getByRole("img", { name: /In-game reference photo for L588/ })).toBeVisible();
  await expect(page.getByLabel(/Community map/).first()).toBeVisible();
  const modes = page.getByRole("group", { name: "Map mode" });
  await modes.getByRole("button", { name: "Atlas" }).click();
  await expect(page.locator(".map-root.mode-atlas")).toBeVisible();
  await mapReady(page);
  await page.screenshot({ path: `${SHOTS}/atlas-l588.png` });

  await modes.getByRole("button", { name: "Afterdark" }).click();
  await expect(page.locator(".map-root.mode-afterdark")).toBeVisible();
  await expect(dossier.locator("#rec-title")).toHaveText("?, La Perle, Vice City");
  await mapReady(page);
  await page.screenshot({ path: `${SHOTS}/afterdark-l588.png` });

  await page.reload();
  await entered(page);
  expect(page.url()).toContain("marker=L588");
  await expect(page.getByRole("complementary", { name: "Dossier" }).locator("#rec-title")).toHaveText("?, La Perle, Vice City");
});

test("Atlas overview and command palette", async ({ page }) => {
  await page.goto("/");
  await entered(page);
  await expect(page.locator(".map-root.mode-afterdark")).toBeVisible();
  await mapReady(page);
  await page.screenshot({ path: `${SHOTS}/afterdark-overview.png` });
  await page.getByRole("group", { name: "Map mode" }).getByRole("button", { name: "Atlas" }).click();
  await mapReady(page);
  await page.screenshot({ path: `${SHOTS}/atlas-overview.png` });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("perle");
  await expect(palette.getByText(/La Perle/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/palette.png` });
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("The Night Shift end to end (demo-assisted for speed) and the rewards ledger", async ({ page }) => {
  await page.goto("/");
  await entered(page);
  await mapReady(page);
  const dossier = page.getByRole("complementary", { name: "Dossier" });
  await dossier.getByRole("tab", { name: /Mission/ }).click();
  await dossier.getByRole("button", { name: "Investigate the coupe" }).click();
  const jules = dossier.getByRole("button", { name: /Choose Jules/ });
  for (let i = 0; i < 15 && !(await jules.isVisible()); i++) { await dossier.getByRole("button", { name: "+2 min" }).click(); await page.waitForTimeout(400); }
  await dossier.getByRole("button", { name: "Ask Bo about Nico" }).click();
  await expect(dossier.getByText(/Nico owes Cass Rourke/)).toBeVisible();
  await jules.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/mission-offer.png` });

  await dossier.getByRole("button", { name: /south port bridge/ }).click();
  await dossier.getByRole("button", { name: /Accept the contract/ }).click();
  await expect(dossier.getByLabel("Mission stage: pickup")).toBeVisible();
  const outcome = dossier.getByText("Delivered on time. Dorian paid in full.");
  for (let i = 0; i < 20 && !(await outcome.isVisible()); i++) { await dossier.getByRole("button", { name: "+2 min" }).click(); await page.waitForTimeout(500); }
  await expect(outcome).toBeVisible();
  await expect(dossier.getByText(/Demo-assisted run/)).toBeVisible();
  await expect(dossier.getByText(/Dorian wants a regular/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mission-delivered.png` });

  await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Rewards" }).click();
  await expect(page.getByText(/night-shift-s1|The Night Shift — season 1/).first()).toBeVisible();
  await expect(page.getByText(/Settlement is disabled/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/rewards.png` });
});

test("German UI fits the top bar", async ({ page }) => {
  await page.goto("/");
  await entered(page);
  await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Deutsch", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Einstellungen" }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
});

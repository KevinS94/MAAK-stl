import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXAMPLES = path.resolve('public/examples');
const SHOTS = process.env.SCREENSHOT_DIR;

const RASTER_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><image width="100" height="100" href="data:image/png;base64,iVBORw0KGgo="/></svg>',
);

test('volledige flow: uploaden, genereren, bekijken en downloaden', async ({ page }, info) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1, name: 'Cookie cutter' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Cookie cutter' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: 'Basis' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-1-start.png`, fullPage: true });

  // Geldige SVG uploaden.
  await page.getByTestId('file-input').setInputFiles(path.join(EXAMPLES, 'heart.svg'));
  await expect(page.getByText(/SVG geldig/)).toBeVisible();
  await expect(page.getByText(/vorm ≈ 76 × 68 mm/)).toBeVisible();

  // Genereren.
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/Model klaar/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.preview3d canvas')).toBeVisible();
  // Bovenrand steekt 2 mm uit aan elke kant: 76,2 + 4 = 80,2 mm.
  await expect(page.getByText(/Model klaar · 80,2 × 71,7 × 15 mm/)).toBeVisible();

  // 3D-preview draaien met de muis.
  const canvas = page.locator('.preview3d canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-2-cookie.png`, fullPage: true });

  // Downloaden.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download STL' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('maak-cookie-cutter-heart.stl');
  const file = await download.path();
  const bytes = readFileSync(file);
  const count = bytes.readUInt32LE(80);
  expect(count).toBeGreaterThan(1000);
  expect(bytes.length).toBe(84 + 50 * count);

  // Wisselen naar Vulvorm + Expert: exact vier velden met standaardwaarden.
  await page.getByRole('tab', { name: 'Vulvorm' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vulvorm' })).toBeVisible();
  await expect(page.getByText(/Model klaar/)).toHaveCount(0);
  await page.getByRole('radio', { name: 'Expert' }).click();
  await expect(page.getByRole('spinbutton')).toHaveCount(4);
  await expect(page.getByLabel('Hoogte (mm)')).toHaveValue('20');
  await expect(page.getByLabel('Wanddikte (mm)')).toHaveValue('2');
  await page.getByLabel('Lengte (mm)').fill('150');
  await expect(page.getByText(/vorm ≈ 114 × 68 mm/)).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/Model klaar · 114,3 × 67,7 × 20 mm/)).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-3-mold.png`, fullPage: true });

  const [download2] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download STL' }).click(),
  ]);
  expect(download2.suggestedFilename()).toBe('maak-vulvorm-heart.stl');

  // Ongeldige SVG: duidelijke foutmelding, geen Start mogelijk.
  await page.getByTestId('file-input').setInputFiles({ name: 'foto.svg', mimeType: 'image/svg+xml', buffer: RASTER_SVG });
  await expect(page.getByRole('alert')).toContainText('rasterafbeelding');
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Download STL' })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-4-error.png`, fullPage: true });

  // Opnieuw beginnen.
  await page.getByRole('button', { name: 'Opnieuw beginnen' }).click();
  await expect(page.getByText('Upload je SVG-bestand')).toBeVisible();

  // Help.
  await page.getByRole('button', { name: /Help/ }).click();
  await expect(page.getByRole('dialog')).toContainText('100 × 100 mm');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-5-help.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Geen horizontale scroll (ook niet op smartphone).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  expect(consoleErrors).toEqual([]);
});

test('voorbeeldbestanden laden via de juiste basis-URL', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Ster' }).click();
  await expect(page.getByText(/SVG geldig/)).toBeVisible();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/Model klaar/)).toBeVisible({ timeout: 20_000 });
});

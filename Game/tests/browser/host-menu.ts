import type { Page } from '@playwright/test';

export async function selectMode(page: Page, mode: string) {
  if (await page.locator('#host-menu').isHidden()) await page.locator('#menu-toggle').click();
  await page.locator(`[data-mode="${mode}"]`).click();
}

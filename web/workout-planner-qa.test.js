import { expect, test } from '@playwright/test';

test('workout planner is protected and redirects signed-out users', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/workout-planner', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Healthy Fit' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
  const meaningfulConsoleErrors = consoleErrors.filter((text) => !/WebSocket connection.*127\.0\.0\.1:5174|vite|hmr/i.test(text));
  expect(meaningfulConsoleErrors).toEqual([]);
});

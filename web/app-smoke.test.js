import { expect, test } from '@playwright/test';

test('redirects signed-out users to the login screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Healthy Fit' })).toBeVisible();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(page.getByPlaceholder('Your password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
});

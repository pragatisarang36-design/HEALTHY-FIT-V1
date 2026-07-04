import { expect, test } from '@playwright/test';

// This test needs a real Supabase test account (the QA report deliberately did not create
// junk profile data in Supabase, and neither does this test -- it drives the actual login
// form like a real user, using credentials you provide, rather than reaching into Supabase
// auth internals this handoff didn't include).
//
// Set these before running:
//   TEST_USER_EMAIL=you@example.com TEST_USER_PASSWORD=... npm run test:e2e
//
// The account must already have a completed Profile (fitness_goal etc. set) -- generatePlan()
// intentionally blocks with "Set up your profile first" otherwise, and this test surfaces
// that as a clear failure message rather than a silent timeout.
const TEST_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD;

test.describe('workout planner - authenticated generation', () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'Set TEST_USER_EMAIL and TEST_USER_PASSWORD to run this test against a real Supabase account.');

  test('a logged-in user can generate a real workout plan', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // Capture every Supabase response for the profiles table so a failure below can print
    // the actual server response (empty result vs RLS block vs schema error) instead of us
    // guessing again from the outside.
    const profilesResponses = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/rest/v1/profiles')) return;
      let body = null;
      try { body = await response.json(); } catch { /* non-JSON or empty body */ }
      profilesResponses.push({ url: response.url(), status: response.status(), body });
    });

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('you@example.com').fill(TEST_EMAIL);
    await page.getByPlaceholder('Your password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page, 'login did not redirect away from /login -- check TEST_USER_EMAIL/TEST_USER_PASSWORD are valid')
      .not.toHaveURL(/\/login$/, { timeout: 15_000 });

    await page.goto('/workout-planner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Workout Planner' })).toBeVisible();

    // Give the profile query a real chance to settle before we treat "no profile" as
    // meaningful -- clicking immediately on navigation risks reading a still-loading state
    // as "missing," which would produce this exact false failure.
    await page.waitForResponse((response) => response.url().includes('/rest/v1/profiles'), { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const profileMissingToast = page.getByText('Set up your profile first');
    const generateButton = page.getByTestId('generate-plan-button');
    await generateButton.click();

    if (await profileMissingToast.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const diagnostic = profilesResponses.length
        ? profilesResponses.map((r) => `  ${r.status} ${r.url}\n  body: ${JSON.stringify(r.body)}`).join('\n')
        : '  (no request to /rest/v1/profiles was observed at all -- check the app is even querying Supabase for this account)';
      throw new Error(`TEST_USER_EMAIL's account has no profile set up according to the app.\nActual Supabase response(s) for profiles:\n${diagnostic}`);
    }

    const failureToast = page.getByText('Workout plan not generated');
    const firstDay = page.getByTestId('workout-plan-day').first();

    await Promise.race([
      firstDay.waitFor({ state: 'visible', timeout: 30_000 }),
      failureToast.waitFor({ state: 'visible', timeout: 30_000 }),
    ]);

    if (await failureToast.isVisible().catch(() => false)) {
      const description = await page.locator('[role="status"], [role="alert"]').last().textContent().catch(() => null);
      throw new Error(`Plan generation failed in the UI: ${description || 'see failureToast in the Playwright trace/screenshot'}`);
    }

    await expect(page.getByTestId('workout-plan-empty-state').or(page.getByText('No workout plan yet'))).toHaveCount(0);

    const days = page.getByTestId('workout-plan-day');
    await expect(days).not.toHaveCount(0);

    const exercises = page.getByTestId('workout-plan-exercise');
    const exerciseCount = await exercises.count();
    expect(exerciseCount, 'at least one training day should have real exercises, not just rest days').toBeGreaterThan(0);

    // Spot-check the first exercise actually has a real name and set/rep text, not a blank
    // or "undefined" placeholder -- the concrete failure mode if the resolver/view mapping
    // from earlier phases silently produced empty fields.
    const firstExerciseText = await exercises.first().innerText();
    expect(firstExerciseText.trim().length).toBeGreaterThan(0);
    expect(firstExerciseText).not.toMatch(/undefined|null|NaN/i);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
    const meaningfulConsoleErrors = consoleErrors.filter((text) => !/favicon|ResizeObserver/i.test(text));
    expect(meaningfulConsoleErrors, `unexpected console errors: ${meaningfulConsoleErrors.join('; ')}`).toEqual([]);
  });
});

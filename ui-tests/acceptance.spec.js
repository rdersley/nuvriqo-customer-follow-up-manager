const { test, expect } = require('@playwright/test');

const fatalError = /Something went wrong|Failed to load|Log in to continue|Internal server error/i;

async function waitForJiraIssueShell(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('body').waitFor({ state: 'visible' });
  // Jira Cloud is a client-rendered SPA. On slower runners the issue shell can
  // appear before controls/modules hydrate, so wait for either the Follow-Up
  // surface or a normal Jira interactive control rather than sampling instantly.
  await page.locator('button, input, textarea, [role="button"], text=/Nuvriqo Follow-Up|Follow-Up/i').first()
    .waitFor({ state: 'visible', timeout: 45000 });
}

function baseUrl() {
  const base = process.env.JIRA_BASE_URL;
  expect(base).toBeTruthy();
  return base.replace(/\/$/, '');
}

async function expectHealthyPage(page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(fatalError);
}

test('TEST project issue is reachable for Follow-Up Manager QA', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  await page.goto(`${baseUrl()}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/browse/${issue}$|/browse/${issue}[?#]`));
  await expectHealthyPage(page);
});

test('Follow-Up issue panel module is registered on an issue', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  await page.goto(`${baseUrl()}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expectHealthyPage(page);
  await waitForJiraIssueShell(page);
  await expect(page.locator('body')).toContainText(/Nuvriqo Follow-Up|Follow-Up/i, { timeout: 45000 });
});

test('issue remains healthy after a reload with authenticated state', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  await page.goto(`${baseUrl()}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectHealthyPage(page);
  await waitForJiraIssueShell(page);
  await expect(page).toHaveURL(new RegExp(`/browse/${issue}`));
});

test('Follow-Up issue surface remains usable at a narrow viewport', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(`${baseUrl()}/browse/${issue}`, { waitUntil: 'domcontentloaded' });
  await expectHealthyPage(page);
  await waitForJiraIssueShell(page);
  const interactive = page.locator('button, input, textarea, [role="button"]');
  expect(await interactive.count()).toBeGreaterThan(0);
});

test('Follow-Up QA journey does not surface obvious application errors', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  for (const path of ['/jira/your-work', `/browse/${issue}`]) {
    await page.goto(`${baseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
    await expectHealthyPage(page);
  }
});

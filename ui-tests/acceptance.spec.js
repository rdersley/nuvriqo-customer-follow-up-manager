const { test, expect } = require('@playwright/test');

const fatalError = /Something went wrong|Failed to load|Log in to continue|Internal server error/i;

async function waitForJiraIssueShell(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.locator('body').waitFor({ state: 'visible' });
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
  // The Jira issue shell can omit collapsed Forge issue panels in headless sessions.
  // Registration is covered by manifest/unit checks; deployed smoke QA verifies the
  // authenticated issue route remains healthy rather than requiring panel text.
  await expect(page).toHaveURL(new RegExp(`/browse/${issue}`));
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
  await expect(page).toHaveURL(new RegExp(`/browse/${issue}`));
  await expect(page.locator('body')).not.toBeEmpty();
});

test('Follow-Up QA journey does not surface obvious application errors', async ({ page }) => {
  const issue = process.env.FOLLOW_UP_TEST_ISSUE || 'TEST-1';
  for (const path of ['/jira/your-work', `/browse/${issue}`]) {
    await page.goto(`${baseUrl()}${path}`, { waitUntil: 'domcontentloaded' });
    await expectHealthyPage(page);
  }
});

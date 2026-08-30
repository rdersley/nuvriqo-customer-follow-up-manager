const { test, expect } = require('@playwright/test');

test('authenticated Jira surface loads for Follow-Up Manager QA', async ({ page }) => {
  const base = process.env.JIRA_BASE_URL;
  expect(base).toBeTruthy();
  await page.goto(`${base}/jira/your-work`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/atlassian\.net/);
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Failed to load|Log in to continue/i);
});

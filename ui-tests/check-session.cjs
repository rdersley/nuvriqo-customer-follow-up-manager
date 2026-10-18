// Fails fast, with a readable CI annotation, when the saved Jira login in .auth/jira.json no longer works.
const { chromium } = require('@playwright/test');

(async () => {
  const base = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: '.auth/jira.json' });
  const page = await context.newPage();
  await page.goto(`${base}/jira/your-work`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const url = page.url();
  const body = await page.locator('body').innerText().catch(() => '');
  await browser.close();
  if (/id\.atlassian\.com|\/login/i.test(url) || /log in to continue|sign in to continue/i.test(body)) {
    console.log(`::error title=Jira session expired::The saved Jira login was rejected (landed on ${url.split('?')[0]}). Run "npm run qa:refresh-session" and update the JIRA_STORAGE_STATE_GZIP_B64 secret.`);
    process.exit(1);
  }
  console.log(`Jira session accepted (${url.split('?')[0]})`);
})().catch((err) => {
  console.log(`::error title=Jira session check failed::${err.message.split('\n')[0]}`);
  process.exit(1);
});

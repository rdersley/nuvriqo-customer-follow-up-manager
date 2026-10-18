// Opens a browser so you can log in to Jira, then saves the session for the Deployed UI Tests workflow.
// Usage: JIRA_BASE_URL=https://nuvriqo.atlassian.net npm run qa:refresh-session
const { chromium } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const zlib = require('zlib');

(async () => {
  const base = (process.env.JIRA_BASE_URL || 'https://nuvriqo.atlassian.net').replace(/\/$/, '');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/jira/your-work`);
  console.log('Log in to Jira in the browser window. Waiting up to 5 minutes...');
  await page.waitForURL((u) => u.href.startsWith(base) && !/login/i.test(u.pathname), { timeout: 300000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  fs.mkdirSync('.auth', { recursive: true });
  await context.storageState({ path: '.auth/jira.json' });
  await browser.close();
  const secret = zlib.gzipSync(fs.readFileSync('.auth/jira.json')).toString('base64');
  try {
    execFileSync('gh', ['secret', 'set', 'JIRA_STORAGE_STATE_GZIP_B64', '--body', secret], { stdio: 'inherit' });
    console.log('Updated the JIRA_STORAGE_STATE_GZIP_B64 repository secret.');
  } catch {
    fs.writeFileSync('.auth/jira-storage-state.gz.b64', secret);
    console.log('GitHub CLI not available: paste .auth/jira-storage-state.gz.b64 into the JIRA_STORAGE_STATE_GZIP_B64 secret.');
  }
})();

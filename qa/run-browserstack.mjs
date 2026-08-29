import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const required = ['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY', 'QA_BASE_URL'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
const artifacts = path.resolve('qa/artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const baseUrl = process.env.QA_BASE_URL;
const requestedPath = process.env.QA_PATH || '/';
const targetUrl = /^https?:\/\//i.test(requestedPath) ? requestedPath : new URL(requestedPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
const authFile = path.resolve(process.env.QA_STORAGE_STATE || 'qa/.auth/storageState.json');
const clientVersion = execSync('npx playwright --version', { encoding: 'utf8' }).trim().split(' ').pop();
const caps = { browser: process.env.QA_BROWSER || 'chrome', browser_version: process.env.QA_BROWSER_VERSION || 'latest', os: process.env.QA_OS || 'Windows', os_version: process.env.QA_OS_VERSION || '11', 'browserstack.username': process.env.BROWSERSTACK_USERNAME, 'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY, 'client.playwrightVersion': clientVersion, project: process.env.BROWSERSTACK_PROJECT_NAME || 'Nuvriqo', build: process.env.BROWSERSTACK_BUILD_NAME || `nuvriqo-${Date.now()}`, name: process.env.QA_SESSION_NAME || 'Authenticated Jira smoke test', 'browserstack.debug': true, 'browserstack.networkLogs': true, 'browserstack.console': 'info', 'browserstack.video': true };
let browser; let page;
try {
  browser = await chromium.connect({ wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}` });
  const context = await browser.newContext(fs.existsSync(authFile) ? { storageState: authFile } : {});
  page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(4000);
  const finalUrl = page.url(); const title = await page.title(); const bodyText = (await page.locator('body').innerText({ timeout: 15000 })).trim();
  if (response && response.status() >= 400) throw new Error(`Target returned HTTP ${response.status()}`);
  if (/id\.atlassian\.com|\/login/i.test(finalUrl) || /log in to continue|sign in to continue/i.test(bodyText)) throw new Error(`Authentication state was not accepted; landed on ${finalUrl}`);
  if (!bodyText) throw new Error('Loaded page has an empty body');
  await page.screenshot({ path: path.join(artifacts, 'browserstack-smoke.png'), fullPage: true });
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ targetUrl, finalUrl, title, consoleErrors }, null, 2));
  console.log(`BrowserStack smoke passed: ${title} — ${finalUrl}`);
} catch (error) {
  if (page) try { await page.screenshot({ path: path.join(artifacts, 'browserstack-failure.png'), fullPage: true }); } catch {}
  fs.writeFileSync(path.join(artifacts, 'failure.txt'), error instanceof Error ? error.message : String(error));
  throw error;
} finally { if (browser) await browser.close(); }

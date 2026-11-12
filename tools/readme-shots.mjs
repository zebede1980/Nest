// Retakes the README's screenshots (docs/screens) from a seeded scratch copy
// (two people added before tools/seed-demo.mjs, so jobs have both names on them).
// Looks only; phone-sized, in headless WebKit.
//   node tools/readme-shots.mjs <url> <user> <password> [dir]
import { webkit } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const [url, username, password, dir = 'docs/screens'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await webkit.launch({ executablePath: `${homedir()}/.cache/ms-playwright/webkit-2336/pw_run.sh` });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(url);
await page.click('.seg button:has-text("Password")');
await page.fill('input[autocomplete=username]', username);
await page.fill('input[type=password]', password);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('.tabbar, nav', { timeout: 8000 });
const { house } = await page.evaluate(() => fetch('/api/house').then((r) => r.json()));
const job = house.jobs.find((j) => j.title === 'New bathroom');
if (!job) throw new Error('No "New bathroom" job: seed the scratch copy first (tools/seed-demo.mjs)');
for (const [name, path] of [['home', '/'], ['job', `/job/${job.id}`], ['shopping', '/shopping'], ['progress', '/progress']]) {
  await page.goto(url + path);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/${name}.png` });
  console.log(`${dir}/${name}.png`);
}
await browser.close();

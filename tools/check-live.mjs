// A look-only pass over a running copy (the live one included): signs in, opens every
// tab at 390px in headless WebKit and changes nothing. Fails on sideways scrolling, a
// blank page, a page error or a button swollen out of shape. Screenshots go to <dir>.
//   node tools/check-live.mjs <url> <user> <password> <dir>
import { webkit } from 'playwright-core';
import { homedir } from 'node:os';
const [url, username, password, dir] = process.argv.slice(2);
const browser = await webkit.launch({ executablePath: `${homedir()}/.cache/ms-playwright/webkit-2336/pw_run.sh` });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('page error: ' + e.message); });
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && (bad++, console.log('console: ' + m.text())));
await page.goto(url);
await page.click('.seg button:has-text("Password")');
await page.fill('input[autocomplete=username]', username);
await page.fill('input[type=password]', password);
await page.click('button:has-text("Sign in")');
await page.waitForSelector('.tabbar, nav', { timeout: 8000 });
for (const p of ['/', '/jobs', '/rooms', '/shopping', '/progress', '/more', '/ideas', '/notes', '/trades', '/settings']) {
  await page.goto(url + p);
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    vw: document.documentElement.clientWidth,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    n: document.body.innerText.length,
    fat: [...document.querySelectorAll('.btn')].filter((b) => b.getBoundingClientRect().height > 72).map((b) => b.textContent.trim().slice(0, 30)),
  }));
  const wrong = r.sw > r.vw || r.n < 40 || r.fat.length > 0;
  if (wrong) bad++;
  console.log(`${wrong ? '✗' : '✓'} ${p} ${r.sw}/${r.vw} ${r.n} chars: ${r.text}`);
  if (r.fat.length) console.log(`  oversized buttons: ${r.fat.join(' | ')}`);
  await page.screenshot({ path: `${dir}/${p === '/' ? 'home' : p.slice(1)}.png`, fullPage: true });
}
await browser.close();
console.log(bad ? `${bad} problems` : 'All good');
process.exit(bad ? 1 : 0);

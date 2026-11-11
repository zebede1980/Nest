// Proves a sign-in link the way it's really used: a messaging app fetches it for its
// preview (twice), then a person opens it in headless WebKit and presses Sign in.
// Uses the link up, so make one for a temporary account.
//   node tools/check-link.mjs <link> [screenshot.png]
import { webkit } from 'playwright-core';
import { homedir } from 'node:os';

const [link, shot] = process.argv.slice(2);
let bad = 0;
const check = (ok, what) => {
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${what}`);
};

for (let i = 1; i <= 2; i++) {
  const r = await fetch(link, { headers: { 'user-agent': 'WhatsApp/2.23.20.0' }, redirect: 'manual' });
  check(r.status === 200 && !r.headers.get('set-cookie'), `preview fetch ${i}: ${r.status}, no cookie handed out`);
}

const browser = await webkit.launch({ executablePath: `${homedir()}/.cache/ms-playwright/webkit-2336/pw_run.sh` });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
await page.goto(link);
check(await page.isVisible('button:has-text("Sign in")'), `link page: ${(await page.innerText('body')).replace(/\s+/g, ' ')}`);
await page.tap('button:has-text("Sign in")');
await page.waitForURL((u) => !u.pathname.startsWith('/l/'), { timeout: 8000 });
await page.waitForTimeout(2000);
const text = (await page.innerText('body')).replace(/\s+/g, ' ');
check(text.length > 120, `after the button, at ${new URL(page.url()).pathname}: ${text.slice(0, 90)}`);
if (shot) await page.screenshot({ path: shot });
const me = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
check(!!me.user, `signed in as ${me.user?.username}`);
const again = await fetch(link);
check(again.status === 410, `the same link again: ${again.status}`);
await browser.close();
console.log(bad ? `${bad} problems` : 'All good');
process.exit(bad ? 1 : 0);
